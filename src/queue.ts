import { ConnectionOptions, Queue, QueueScheduler, Worker } from 'bullmq';
import { env } from './env';

// Updated interfaces without Convex dependencies
interface ZendeskCredentials {
  token: string;
  email: string;
}

interface InstanceInfo {
  id: string; // Source or target ID
  name: string;
  subdomain: string;
  tags: string[];
  credentials: Record<string, string>;
}

interface Snapshot {
  id: string;
  name: string;
  sourceId: string | null;
  locked: boolean;
  createdAt: string;
  breakdown: any;
  tags: string[];
}

interface MigrationJobData {
  jobId: string;
  type: string;
  source: {
    type: 'snapshot' | 'live';
    instanceInfo: InstanceInfo;
    snapshotId?: string;
  };
  target: {
    instanceInfo: InstanceInfo;
  };
  ignoredItems?: string[];
  translation?: boolean;
  translationLocales?: string[];
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
      sourceId: "1",
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
      const { source, target, jobId, ignoredItems = [] } = job.data;
      let snapshot: Snapshot | null = null;

      // Initialize progress tracking using MIGRATION_ORDER
      const totalSteps = MIGRATION_ORDER.length;
      let currentStep = 0;

      // Create temporary storage for this job
      const jobTempPath = `tmp/${jobId}`;
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
          await validateSnapshot(snapshot, MIGRATION_ORDER);
          await job.log(`Snapshot validation successful`);
        }

        // Filter ignored items from MIGRATION_ORDER
        const componentsToMigrate = MIGRATION_ORDER.filter(
          comp => !ignoredItems.includes(comp)
        );

        for (const component of componentsToMigrate) {
          await job.log(`Starting migration of ${component}`);
          
          try {
            // Get source data
            let sourceData;
            if (source.type === 'snapshot' && snapshot) {
              const componentInfo = snapshot.breakdown[component];
              await job.log(`Fetching ${component} from snapshot (size: ${componentInfo.size} bytes)`);
              sourceData = await fetchSnapshotData(component, componentInfo.file);
            } else {
              await job.log(`Fetching ${component} from live instance ${source.instanceInfo.subdomain}`);
              sourceData = await fetchLiveData(component, source.instanceInfo);
            }

            // Process and create in target
            await job.log(`Creating ${component} in target instance ${target.instanceInfo.subdomain}`);
            // TODO: Implement creation in target instance
            
            // Update progress
            currentStep++;
            await job.updateProgress((currentStep / totalSteps) * 100);
            
          } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
            await job.log(`Error processing ${component}: ${errorMessage}`);
            throw error;
          }
        }

        return {
          status: 'completed',
          jobId
        };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
        await job.log(`Fatal error in migration job: ${errorMessage}`);
        throw error;
      } finally {
        // Cleanup temp storage
        // TODO: Implement cleanup of jobTempPath
      }
    },
    { connection }
  );
};
