import { ConnectionOptions, Queue, QueueScheduler, Worker } from 'bullmq';

import { env } from './env';

interface ZendeskCredentials {
  token: string;
  email: string;
}

interface InstanceInfo {
  id: string;
  name: string;
  subdomain: string;
  tags: string[];
  credentials: ZendeskCredentials;
}

interface ComponentBreakdown {
  count: string;
  size: number;
  file: string;
}

interface Snapshot {
  id: string;
  name: string;
  tags: string[];
  parentId: string;
  locked: boolean;
  createdAt: string;
  breakdown: {
    [key: string]: ComponentBreakdown;
  };
}

interface MigrationJobData {
  source: {
    type: 'snapshot' | 'live';
    instanceInfo: InstanceInfo;
    snapshotId?: string;
  };
  target: {
    instanceInfo: InstanceInfo;
  };
  job: {
    id: string;
    components: string[];
  };
}

interface IdMapping {
  oldId: string | number;
  newId: string | number;
  type: string;
  metadata?: Record<string, any>;
}

const connection: ConnectionOptions = {
  host: env.REDISHOST,
  port: env.REDISPORT,
  username: env.REDISUSER,
  password: env.REDISPASSWORD,
};

export const createQueue = (name: string) => new Queue(name, { connection });

// Components ordered by their dependencies
const MIGRATION_ORDER = [
  'custom_statuses',
  'groups',
  'custom_roles',
  'ticket_fields',
  'ticket_forms',
  'brands',
  'dynamic_content',
  'macros',
  'triggers',
  'trigger_categories',
  'views',
  'webhooks',
  'apps',
  'skills'
];

const validateSnapshot = async (snapshot: Snapshot, components: string[]) => {
  if (!snapshot) {
    throw new Error('Snapshot not found');
  }
  
  if (!snapshot.breakdown) {
    throw new Error('Snapshot breakdown is missing');
  }

  const missingComponents = components.filter(comp => !snapshot.breakdown[comp]);
  if (missingComponents.length > 0) {
    throw new Error(`Snapshot missing required components: ${missingComponents.join(', ')}`);
  }
  if (snapshot.locked) {
    throw new Error('Cannot use locked snapshot for migration');
  }
};

// Mock function to simulate fetching snapshot from Convex
// TODO: Replace with actual Convex fetch
const fetchSnapshotFromConvex = async (snapshotId: any): Promise<Snapshot | null> => {
  // This is temporary mock data based on your snapshots.json
  const mockSnapshots: { [key: number]: Snapshot } = {
    1: {
      id: "1",
      name: "Snapshot 1",
      tags: ["dev", "stable", "backup"],
      parentId: "1",
      locked: false,
      createdAt: "2024-01-01T00:00:00.000Z",
      breakdown: {
        ticket_fields: {
          count: "10",
          size: 4500,
          file: "/1/1/ticket_fields.json"
        },
        ticket_forms: {
          count: "1",
          size: 2500,
          file: "/1/1/ticket_forms.json"
        },
        // ... other components
      }
    }
  };

  return mockSnapshots[snapshotId] || null;
};

const fetchSnapshotData = async (component: string, filePath: string) => {
  // TODO: Implement actual fetch from object storage
  // This would interact with your Convex storage to get the JSON file
  await new Promise(resolve => setTimeout(resolve, 1000)); // Simulate network delay
  return {
    mock: true,
    component,
    filePath
  };
};

const fetchLiveData = async (
  component: string,
  instanceInfo: InstanceInfo
) => {
  // TODO: Implement actual fetch from Zendesk API
  // This would use the instanceInfo.credentials to authenticate
  return null;
};

export const setupQueueProcessor = async (queueName: string) => {
  const queueScheduler = new QueueScheduler(queueName, {
    connection,
  });
  await queueScheduler.waitUntilReady();

  new Worker<MigrationJobData>(
    queueName,
    async (job) => {
      const { source, target, job: migrationJob } = job.data;
      const idMappings: IdMapping[] = [];
      let snapshot: Snapshot | null = null;

      // Initialize progress tracking
      const totalSteps = migrationJob.components.length;
      let currentStep = 0;

      // Create temporary storage for this job
      const jobTempPath = `tmp/${migrationJob.id}`;
      await job.log(`Initializing migration job at ${jobTempPath}`);

      try {
        // If using snapshot, validate it first
        if (source.type === 'snapshot' && source.snapshotId) {
          await job.log(`Fetching snapshot ${source.snapshotId}`);
          snapshot = await fetchSnapshotFromConvex(source.snapshotId);
          
          if (!snapshot) {
            throw new Error(`Snapshot ${source.snapshotId} not found`);
          }

          await job.log(`Validating snapshot ${snapshot.name}`);
          await validateSnapshot(snapshot, migrationJob.components);
          await job.log(`Snapshot validation successful`);
        }

        // Sort components based on migration order
        const sortedComponents = migrationJob.components.sort(
          (a, b) => MIGRATION_ORDER.indexOf(a) - MIGRATION_ORDER.indexOf(b)
        );

        for (const component of sortedComponents) {
          await job.log(`Starting migration of ${component}`);
          
          try {
            // 1. Get source data
            let sourceData;
            if (source.type === 'snapshot' && snapshot) {
              const componentInfo = snapshot.breakdown[component];
              await job.log(`Fetching ${component} from snapshot (size: ${componentInfo.size} bytes)`);
              sourceData = await fetchSnapshotData(
                component,
                componentInfo.file
              );
            } else {
              await job.log(`Fetching ${component} from live instance ${source.instanceInfo.subdomain}`);
              sourceData = await fetchLiveData(component, source.instanceInfo);
              // Save live data to temp storage
              // TODO: Implement save to jobTempPath
            }

            // 2. Process the component
            await job.log(`Processing ${component} (${currentStep + 1}/${totalSteps})`);
            
            // 3. Create in target instance
            await job.log(`Creating ${component} in target instance ${target.instanceInfo.subdomain}`);
            // TODO: Implement creation in target instance
            
            // 4. Store ID mappings
            // TODO: Store mappings in your Convex DB
            
            // 5. Update progress
            currentStep++;
            await job.updateProgress((currentStep / totalSteps) * 100);
            
          } catch (error) {
            const errorMessage = error instanceof Error 
              ? error.message 
              : 'An unknown error occurred';
            await job.log(`Error processing ${component}: ${errorMessage}`);
            throw error;
          }
        }

        // Cleanup temp storage
        // TODO: Implement cleanup of jobTempPath

        return {
          status: 'completed',
          idMappings,
          jobId: migrationJob.id
        };
      } catch (error) {
        // Cleanup temp storage on error
        // TODO: Implement cleanup of jobTempPath
        const errorMessage = error instanceof Error 
          ? error.message 
          : 'An unknown error occurred';
        await job.log(`Fatal error in migration job: ${errorMessage}`);
        throw error;
      }
    },
    { connection }
  );
};
