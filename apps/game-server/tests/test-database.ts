
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { PrismaClient } from '@prisma/client';

const requireTestUrl = (
  name: 'DATABASE_URL' | 'DIRECT_URL'
): string => {
  const value = process.env[name];

  if (!value) {
    throw new Error(`${name} is required for backend tests`);
  }

  return value;
};

let migrationPromise: Promise<void> | undefined;

const quoteIdentifier = (value: string): string =>
  `"${value.replaceAll('"', '""')}"`;

export const createTestDatabase = (_suiteName: string) => {
  const pooledUrl = requireTestUrl('DATABASE_URL');
  const directUrl = requireTestUrl('DIRECT_URL');

  const pooledBase = new URL(pooledUrl);
  const directBase = new URL(directUrl);

  const pooledSchema = pooledBase.searchParams.get('schema');
  const directSchema = directBase.searchParams.get('schema');
  const expectedSchema = process.env.TEST_DATABASE_SCHEMA;

  if (!pooledSchema || !directSchema) {
    throw new Error(
      'DATABASE_URL and DIRECT_URL must include the test schema.'
    );
  }

  if (pooledSchema !== directSchema) {
    throw new Error(
      'DATABASE_URL and DIRECT_URL must use the same schema.'
    );
  }

  if (!expectedSchema || pooledSchema !== expectedSchema) {
    throw new Error(
      'Database schema does not match TEST_DATABASE_SCHEMA.'
    );
  }

  directBase.searchParams.delete('schema');

  const prisma = new PrismaClient({
    datasources: {
      db: {
        url: pooledUrl,
      },
    },
  });

  return {
    prisma,

    async migrate(): Promise<void> {
      if (!migrationPromise) {
        migrationPromise = (async () => {
          const schemaAdmin = new PrismaClient({
            datasources: {
              db: {
                url: directBase.toString(),
              },
            },
          });

          try {
            await schemaAdmin.$executeRawUnsafe(
              `CREATE SCHEMA IF NOT EXISTS ${quoteIdentifier(pooledSchema)}`
            );
          } finally {
            await schemaAdmin.$disconnect();
          }

          execFileSync(
            resolve('node_modules/.bin/prisma'),
            ['migrate', 'deploy'],
            {
              cwd: process.cwd(),
              env: {
                ...process.env,
                DATABASE_URL: pooledUrl,
                DIRECT_URL: directUrl,
              },
              stdio: 'inherit',
            }
          );
        })().catch((error) => {
          migrationPromise = undefined;

          throw new Error(
            `Test database migration failed: ${
              error instanceof Error ? error.message : String(error)
            }`
          );
        });
      }

      await migrationPromise;
    },

    async disconnect(): Promise<void> {
      await prisma.$disconnect();
    },
  };
};
