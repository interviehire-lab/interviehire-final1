import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import websocket from '@fastify/websocket';
import rateLimit from '@fastify/rate-limit';
import multipart from '@fastify/multipart';
import { assistantRoutes } from './routes/assistant.routes.js';
import { companyRoutes } from './routes/company.routes.js';
import { interviewRoutes } from './routes/interview.routes.js';
import { transcriptRoutes } from './routes/transcript.routes.js';
import { internalRoutes } from './routes/internal.routes.js';
import { vapiRoutes } from './routes/vapi.routes.js';
import { registerWebsocket } from './websocket/gateway.js';

const serverDirectory = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(serverDirectory, '../../../.env') });

// Fastify's default bodyLimit (1 MiB) is fine for JSON, but far too small for a
// full interview recording upload (video + audio, tens to hundreds of MB) — the
// multipart plugin falls back to this same limit unless given its own.
const RECORDING_UPLOAD_LIMIT_BYTES = 500 * 1024 * 1024;

const isProduction = process.env.NODE_ENV === 'production';
const app = Fastify({
  bodyLimit: RECORDING_UPLOAD_LIMIT_BYTES,
  logger: {
    level: process.env.LOG_LEVEL || (isProduction ? 'info' : 'debug'),
    // Keep credentials out of both readable local output and Railway's JSON
    // logs if a request is ever logged with its headers attached.
    redact: {
      paths: [
        'req.headers.authorization',
        'req.headers.cookie',
        'req.headers["x-vapi-webhook-secret"]',
      ],
      censor: '[Redacted]',
    },
    // JSON is ideal for Railway/log aggregation. During local development,
    // pino-pretty turns Fastify's JSON events into compact, readable lines.
    ...(!isProduction && {
      transport: {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'SYS:standard',
          ignore: 'pid,hostname',
          singleLine: true,
        },
      },
    }),
  },
});
await app.register(cors, { origin: true, credentials: true });
await app.register(rateLimit, { max: 200, timeWindow: '1 minute' });
await app.register(multipart, { limits: { fileSize: RECORDING_UPLOAD_LIMIT_BYTES } });
await app.register(websocket);
app.get('/health', async () => ({ ok: true, service: 'interviehire-api' }));
await app.register(companyRoutes, { prefix: '/api/company' });
await app.register(interviewRoutes, { prefix: '/api/interview' });
await app.register(transcriptRoutes, { prefix: '/api/interviews' });
await app.register(assistantRoutes, { prefix: '/api/assistant' });
await app.register(internalRoutes, { prefix: '/internal' });
await app.register(vapiRoutes, { prefix: '/api/vapi' });
await registerWebsocket(app);

const port = Number(process.env.PORT || 4000);
app.listen({ port, host: '0.0.0.0' }).catch(err => { app.log.error(err); process.exit(1); });
