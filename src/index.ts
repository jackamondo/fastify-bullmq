import { createBullBoard } from '@bull-board/api';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import { FastifyAdapter } from '@bull-board/fastify';
import fastify, { FastifyInstance, FastifyRequest } from 'fastify';
import { Server, IncomingMessage, ServerResponse } from 'http';
import { env } from './env';

import { createQueue, setupQueueProcessor } from './queue';

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

interface MigrationJobBody {
  source: {
    type: 'snapshot' | 'live';
    instanceInfo: InstanceInfo;
    snapshotId?: number;
  };
  target: {
    instanceInfo: InstanceInfo;
  };
  components: string[];
}

const run = async () => {
  const migrationQueue = createQueue('ZendeskMigrationQueue');
  await setupQueueProcessor(migrationQueue.name);

  const server: FastifyInstance<Server, IncomingMessage, ServerResponse> =
    fastify();

  const serverAdapter = new FastifyAdapter();
  createBullBoard({
    queues: [new BullMQAdapter(migrationQueue)],
    serverAdapter,
  });
  serverAdapter.setBasePath('/');
  server.register(serverAdapter.registerPlugin(), {
    prefix: '/',
    basePath: '/',
  });

  server.post(
    '/migration',
    {
      schema: {
        body: {
          type: 'object',
          required: ['source', 'target', 'components'],
          properties: {
            source: {
              type: 'object',
              required: ['type', 'instanceInfo'],
              properties: {
                type: { type: 'string', enum: ['snapshot', 'live'] },
                instanceInfo: {
                  type: 'object',
                  required: ['id', 'name', 'subdomain', 'credentials'],
                  properties: {
                    id: { type: 'number' },
                    name: { type: 'string' },
                    subdomain: { type: 'string' },
                    tags: { type: 'array', items: { type: 'string' } },
                    credentials: {
                      type: 'object',
                      required: ['token', 'email'],
                      properties: {
                        token: { type: 'string' },
                        email: { type: 'string' }
                      }
                    }
                  }
                },
                snapshotId: { type: 'number' }
              }
            },
            target: {
              type: 'object',
              required: ['instanceInfo'],
              properties: {
                instanceInfo: {
                  type: 'object',
                  required: ['id', 'name', 'subdomain', 'credentials'],
                  properties: {
                    id: { type: 'number' },
                    name: { type: 'string' },
                    subdomain: { type: 'string' },
                    tags: { type: 'array', items: { type: 'string' } },
                    credentials: {
                      type: 'object',
                      required: ['token', 'email'],
                      properties: {
                        token: { type: 'string' },
                        email: { type: 'string' }
                      }
                    }
                  }
                }
              }
            },
            components: {
              type: 'array',
              items: { type: 'string' }
            }
          }
        }
      }
    },
    async (req: FastifyRequest<{ Body: MigrationJobBody }>, reply) => {
      const jobId = `migration-${Date.now()}`;
      
      await migrationQueue.add(jobId, {
        source: req.body.source,
        target: req.body.target,
        job: {
          id: jobId,
          components: req.body.components,
        },
      });

      reply.send({
        jobId,
        status: 'queued',
        message: 'Migration job has been queued',
        details: {
          source: {
            name: req.body.source.instanceInfo.name,
            type: req.body.source.type,
            ...(req.body.source.snapshotId && { snapshotId: req.body.source.snapshotId })
          },
          target: {
            name: req.body.target.instanceInfo.name
          },
          components: req.body.components
        }
      });
    }
  );

  await server.listen({ port: env.PORT, host: '0.0.0.0' });
  console.log(
    `Server running. Send a POST request to https://${env.RAILWAY_STATIC_URL}/migration with source and target instance details`
  );
};

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
