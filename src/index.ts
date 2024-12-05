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
  id: string;
  name: string;
  subdomain: string;
  tags: string[];
  credentials: Record<string, string>;
}

interface MigrationJobBody {
  type: string;
  source: {
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
          required: ['source', 'target', 'type'],
          properties: {
            type: { type: 'string' },
            source: {
              type: 'object',
              required: ['instanceInfo'],
              properties: {
                instanceInfo: {
                  type: 'object',
                  required: ['id', 'name', 'subdomain', 'credentials'],
                  properties: {
                    id: { type: 'string' },
                    name: { type: 'string' },
                    subdomain: { type: 'string' },
                    tags: { type: 'array', items: { type: 'string' } },
                    credentials: {
                      type: 'object',
                      additionalProperties: { type: 'string' }
                    }
                  }
                },
                snapshotId: { type: 'string' }
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
                    id: { type: 'string' },
                    name: { type: 'string' },
                    subdomain: { type: 'string' },
                    tags: { type: 'array', items: { type: 'string' } },
                    credentials: {
                      type: 'object',
                      additionalProperties: { type: 'string' }
                    }
                  }
                }
              }
            },
            ignoredItems: {
              type: 'array',
              items: { type: 'string' }
            },
            translation: { type: 'boolean' },
            translationLocales: {
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
        jobId,
        type: req.body.type,
        source: req.body.source,
        target: req.body.target,
        ignoredItems: req.body.ignoredItems,
        translation: req.body.translation,
        translationLocales: req.body.translationLocales
      });

      reply.send({
        jobId,
        status: 'queued',
        message: 'Migration job has been queued',
        details: {
          type: req.body.type,
          source: {
            name: req.body.source.instanceInfo.name,
            ...(req.body.source.snapshotId && { snapshotId: req.body.source.snapshotId })
          },
          target: {
            name: req.body.target.instanceInfo.name
          },
          ignoredItems: req.body.ignoredItems,
          translation: req.body.translation,
          translationLocales: req.body.translationLocales
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
