import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
try {
  const mode = process.env.DEPLOYMENT_MODE;
  if (!['initialize', 'restore-existing'].includes(mode)) throw new Error('Explicit deployment mode is required.');
  const tables = await prisma.$queryRaw`SELECT tablename FROM pg_tables WHERE schemaname = 'public'`;
  if (mode === 'initialize' && tables.length !== 0) {
    throw new Error('Initialization requires an empty public schema. Restore/maintenance requires restore-existing mode.');
  }
  if (mode === 'restore-existing') {
    if (!tables.some((table) => table.tablename === 'Household')) throw new Error('Restored Household table is missing.');
    const households = await prisma.household.count();
    if (households === 0) throw new Error('Restored database contains no households; initialization is forbidden in restore-existing mode.');
  }
  console.log('Database preflight passed for ' + mode + '.');
} catch (error) {
  // Do not print database URLs or raw Prisma connection errors.
  console.error(error.message.startsWith('Invalid') ? 'Database preflight query failed.' : error.message);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
