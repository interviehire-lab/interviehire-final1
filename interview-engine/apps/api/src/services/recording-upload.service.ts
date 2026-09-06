import fs from 'node:fs';

// Forwards a locally-saved interview recording to the FastAPI backend, which uploads it
// into the shared Backblaze B2 "proctoring-videos" bucket (see backend/app/utils/backblaze.py).
// Fire-and-forget from the caller — this must never throw into a candidate-facing response.
export async function uploadRecordingToStorage(
  sessionId: string,
  filePath: string,
  filename: string,
  mimeType: string,
): Promise<{ b2Key: string } | null> {
  const backendUrl = process.env.BACKEND_URL;
  if (!backendUrl) return null;

  const buffer = fs.readFileSync(filePath);
  const form = new FormData();
  form.append('file', new Blob([buffer], { type: mimeType }), filename);

  const res = await fetch(`${backendUrl.replace(/\/$/, '')}/api/public/interview-session/${sessionId}/recording`, {
    method: 'POST',
    headers: { 'X-Webhook-Secret': process.env.ENGINE_WEBHOOK_SECRET ?? '' },
    body: form,
  });

  if (!res.ok) {
    throw new Error(`Recording upload forward failed: ${res.status} ${await res.text()}`);
  }

  const data = await res.json();
  if (!data?.ok || !data?.b2Key) return null;
  return { b2Key: data.b2Key };
}
