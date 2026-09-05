import { z } from 'zod';

const requiredSecret = z.string().trim().min(1);

const envSchema = z.object({
  LIVEKIT_URL: z.string().trim().url().startsWith('wss://'),
  LIVEKIT_API_KEY: requiredSecret,
  LIVEKIT_API_SECRET: requiredSecret,
  LIVEKIT_AGENT_NAME: z.string().trim().min(1).default('interviehire-interviewer'),
  DEEPGRAM_API_KEY: requiredSecret,
  CARTESIA_API_KEY: requiredSecret,
  CARTESIA_VOICE_ID: z.string().trim().min(1),
  CARTESIA_MODEL: z.string().trim().min(1).default('sonic-3'),
  ENGINE_INTERNAL_URL: z.string().trim().url(),
  INTERNAL_SERVICE_SECRET: requiredSecret,
  INTERVIEW_HARD_LIMIT_SECONDS: z.coerce.number().int().positive().max(1800).default(1800),
  INTERVIEW_CLOSING_RESERVE_SECONDS: z.coerce.number().int().positive().max(120).default(45),
  ENGINE_REQUEST_TIMEOUT_MS: z.coerce.number().int().min(1000).max(30000).default(10000),
  PORT: z.coerce.number().int().min(1).max(65535).default(8081),
});

export type VoiceAgentConfig = z.infer<typeof envSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): VoiceAgentConfig {
  const parsed = envSchema.safeParse(env);
  if (parsed.success) return parsed.data;

  const details = parsed.error.issues
    .map((issue) => `${issue.path.join('.') || 'environment'}: ${issue.message}`)
    .join('; ');
  throw new Error(`Invalid voice-agent configuration: ${details}`);
}
