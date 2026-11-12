import { handleCallback } from '@vercel/queue';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { carePool, enqueueOverdue } from '../server/queue-runtime.mjs';

const require = createRequire(import.meta.url);
export default { fetch: handleCallback(async job => {
  const { processOverdueJob } = require(resolve(process.cwd(), 'care-runtime/server/vercel-overdue.js'));
  await processOverdueJob(carePool(), job, enqueueOverdue);
}) };
