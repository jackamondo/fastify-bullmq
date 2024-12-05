import { ConnectionOptions, Queue, QueueScheduler, Worker } from 'bullmq';

import { env } from './env';

interface ZendeskCredentials {
  token: string;
  email: string;
}

interface InstanceInfo {
  id: number;
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
  id: number;
  name: string;
  tags: string[];
  parentId: number;
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
    snapshotId?: number;
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
  const missingComponents = components.filter(comp => !snapshot.breakdown[comp]);
  if (missingComponents.length > 0) {
    throw new Error(`Snapshot missing required components: ${missingComponents.join(', ')}`);
  }
  if (snapshot.locked) {
    throw new Error('Cannot use locked snapshot for migration');
  }
};

const fetchSnapshotData = async (component: string, filePath: string) => {
  // TODO: Implement actual fetch from object storage
  // This would interact with your Convex storage to get the JSON file
  return null;
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

      // Initialize progress tracking
      const totalSteps = migrationJob.components.length;
      let currentStep = 0;

      // Sort components based on migration order
      const sortedComponents = migrationJob.components.sort(
        (a, b) => MIGRATION_ORDER.indexOf(a) - MIGRATION_ORDER.indexOf(b)
      );

      // Create temporary storage for this job
      const jobTempPath = `tmp/${migrationJob.id}`;
      await job.log(`Initializing migration job at ${jobTempPath}`);

      try {
        // If using snapshot, validate it first
        if (source.type === 'snapshot' && source.snapshotId) {
          // TODO: Fetch snapshot from your Convex DB
          const snapshot: Snapshot = {} as Snapshot; // Replace with actual fetch
          await validateSnapshot(snapshot, migrationJob.components);
        }

        for (const component of sortedComponents) {
          await job.log(`Starting migration of ${component}`);
          
          try {
            // 1. Get source data
            let sourceData;
            if (source.type === 'snapshot' && source.snapshotId) {
              // TODO: Get snapshot info from Convex
              const snapshot: Snapshot = {} as Snapshot; // Replace with actual fetch
              sourceData = await fetchSnapshotData(
                component,
                snapshot.breakdown[component].file
              );
            } else {
              sourceData = await fetchLiveData(component, source.instanceInfo);
              // Save live data to temp storage
              // TODO: Implement save to jobTempPath
            }

            // 2. Process the component
            await job.log(`Processing ${component} (${currentStep + 1}/${totalSteps})`);
            
            // 3. Create in target instance
            // TODO: Implement creation in target instance using target.instanceInfo.credentials
            
            // 4. Store ID mappings
            // TODO: Store mappings in your Convex DB for future reference
            
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
