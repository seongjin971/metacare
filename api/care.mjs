import { carePool, enqueueOverdue } from '../server/queue-runtime.mjs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

// The server's JS output ships in the function, outside the public website directory.
const require = createRequire(import.meta.url);
let handler;

export default {
  async fetch(request) {
    if (!process.env.DATABASE_URL) {
      return Response.json({ error: '공유 서버가 준비되지 않았어요.' }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
    }
    if (!handler) {
      const { createVercelCareHandler } = require(resolve(process.cwd(), 'care-runtime/server/vercel-care.js'));
      handler = createVercelCareHandler(carePool(), { enqueue: enqueueOverdue });
    }
    return handler(request);
  },
};
