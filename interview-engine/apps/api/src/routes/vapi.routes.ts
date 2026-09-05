import { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { handleCandidateTranscript } from '../services/interview-conversation.service.js';

// Vapi's (and ElevenLabs') "Custom LLM" mechanism is a plain OpenAI
// chat-completions-compatible SSE endpoint — confirmed identical contract shape
// on both platforms. handleCandidateTranscript() itself is completely
// unchanged; this gives Vapi a standard HTTP shape to drive it through instead
// of the legacy (unused in the main room) WebSocket voice path.
const requestSchema = z.object({
  messages: z.array(z.object({ role: z.string(), content: z.string() })).min(1),
  model: z.string().optional(),
  stream: z.boolean().optional(),
  // Vapi's documented mechanism for correlating a call to your own session id:
  // metadata set on the assistant/call ({ metadata: { sessionId } }) is echoed
  // back on every Custom LLM request for that call. UNVERIFIED against a real
  // Vapi payload — Vapi's docs didn't give full field-level detail on the request
  // shape, only the response contract (confirmed via ElevenLabs' equivalent +
  // the shared OpenAI-compatible convention both platforms use). If this field
  // path is wrong, the raw-body debug log below will show the real one.
  metadata: z.object({ sessionId: z.string().optional() }).optional(),
  call: z.object({ metadata: z.object({ sessionId: z.string().optional() }).optional() }).optional(),
});

function sseChunk(content: string): string {
  const payload = {
    id: `chatcmpl-${Date.now()}`,
    object: 'chat.completion.chunk',
    choices: [{ delta: { content }, finish_reason: null }],
  };
  return `data: ${JSON.stringify(payload)}\n\n`;
}

export async function vapiRoutes(app: FastifyInstance) {
  let warnedMissingSecret = false;

  const handleLlmRequest = async (req: any, reply: any) => {
    const expectedSecret = process.env.VAPI_WEBHOOK_SECRET?.trim();
    if (expectedSecret) {
      const suppliedSecret = req.headers['x-vapi-webhook-secret'];
      if (suppliedSecret !== expectedSecret) {
        req.log.warn(
          {
            path: req.url,
            hasWebhookSecretHeader: typeof suppliedSecret === 'string' && suppliedSecret.length > 0,
          },
          'Vapi Custom LLM request rejected: webhook secret is missing or does not match',
        );
        reply.code(401);
        return { error: 'Unauthorized' };
      }
    } else if (!warnedMissingSecret) {
      warnedMissingSecret = true;
      app.log.warn('[vapi.routes] VAPI_WEBHOOK_SECRET is unset; webhook authentication is disabled');
    }

    const body = requestSchema.parse(req.body);

    // Best-effort extraction across the couple of shapes these platforms
    // commonly use for call metadata — see the schema comment above.
    const sessionId = body.metadata?.sessionId || body.call?.metadata?.sessionId;
    if (!sessionId) {
      app.log.warn({ body: req.body }, '[vapi.routes] no sessionId found in request — logging raw body for field-path discovery');
      reply.code(400);
      return { error: 'sessionId not found in request metadata' };
    }

    const lastUserMessage = [...body.messages].reverse().find((m) => m.role === 'user');
    const text = (lastUserMessage?.content ?? '').trim();
    if (!text) {
      reply.code(400);
      return { error: 'No user message text found' };
    }

    req.log.info(
      { sessionId, messageCount: body.messages.length, streaming: body.stream === true },
      'Processing Vapi Custom LLM turn',
    );
    const ai = await handleCandidateTranscript(sessionId, text, {});

    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });
    // handleCandidateTranscript returns its whole decision in one shot (it's an
    // LLM call itself, not a token stream) — so this is one chunk, not real
    // token-by-token streaming. That's fine: Vapi/ElevenLabs both just need
    // valid SSE framing, not literal incremental generation.
    reply.raw.write(sseChunk(ai.text));
    reply.raw.write('data: [DONE]\n\n');
    reply.raw.end();
    return reply;
  };

  // Vapi normally posts to the configured URL directly, while some
  // OpenAI-compatible clients append /chat/completions. Support both forms.
  app.post('/llm', handleLlmRequest);
  app.post('/llm/chat/completions', handleLlmRequest);
}
