const CLOSING_LINE = "Thanks. That completes our interview. I'll end the session now, and your report will be prepared automatically.";

/**
 * Read-only setup preview for the single shared Vapi assistant. Values that are
 * credentials (or a subjective voice choice) deliberately remain placeholders:
 * this object is returned by a public setup endpoint and must never disclose a
 * Railway secret.
 */
export function buildVapiAssistantConfig() {
  const publicEngineUrl = (process.env.PUBLIC_ENGINE_URL?.trim() || '<PUBLIC_ENGINE_URL>').replace(/\/$/, '');
  return {
    name: 'IntervieHire Adaptive Interviewer',
    model: {
      provider: 'custom-llm',
      url: `${publicEngineUrl}/api/vapi/llm`,
      model: 'interviehire-director',
      metadataSendMode: 'variable',
      headers: { 'x-vapi-webhook-secret': '<VAPI_WEBHOOK_SECRET>' },
    },
    transcriber: { provider: 'deepgram', model: 'nova-2' },
    voice: { provider: 'cartesia', voiceId: '<CARTESIA_VOICE_ID>' },
    firstMessage: '{{firstQuestion}}',
    clientMessages: ['transcript', 'speech-update'],
    endCallPhrases: [CLOSING_LINE],
  };
}
