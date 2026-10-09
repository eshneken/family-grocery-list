import { PrismaClient } from '@prisma/client';

class DatabasePreflightError extends Error {}

const prisma = new PrismaClient();
try {
  const mode = process.env.DEPLOYMENT_MODE;
  if (!['initialize', 'restore-existing'].includes(mode)) throw new DatabasePreflightError('Explicit deployment mode is required.');
  const tables = await prisma.$queryRaw`SELECT tablename FROM pg_tables WHERE schemaname = 'public'`;
  if (mode === 'initialize' && tables.length !== 0) {
    throw new DatabasePreflightError('Initialization requires an empty public schema. Existing database maintenance requires restore-existing mode.');
  }
  if (mode === 'restore-existing') {
    if (!tables.some((table) => table.tablename === 'Household')) throw new DatabasePreflightError('Existing Household table is missing.');
    const households = await prisma.household.count();
    if (households === 0) throw new DatabasePreflightError('Existing database contains no households; initialization is forbidden in restore-existing mode.');
  }
  console.log('Database preflight passed for ' + mode + '.');
} catch (error) {
  // Do not print database URLs or raw Prisma connection errors.
  console.error(error instanceof DatabasePreflightError ? error.message : 'Database preflight query failed.');
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
