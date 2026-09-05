# Railway LiveKit voice worker

The LiveKit integration uses the existing Fastify engine plus one private,
always-on Railway worker. The worker connects outbound to LiveKit Cloud, so it
does not need a public domain or a Railway healthcheck.

## 1. Create a LiveKit Cloud project

Copy its WebSocket URL, API key, and API secret. Keep the key and secret on
Railway; neither belongs in Vercel or any `NEXT_PUBLIC_*` variable.

## 2. Configure the existing `engine` service

Add these Railway variables:

```text
LIVEKIT_URL=wss://<project>.livekit.cloud
LIVEKIT_API_KEY=<livekit api key>
LIVEKIT_API_SECRET=<livekit api secret>
LIVEKIT_AGENT_NAME=interviehire-interviewer
INTERNAL_SERVICE_SECRET=<one long random value>
```

Keep the engine's existing `DATABASE_URL`, `DEEPSEEK_API_KEY`, and public domain.
Redeploy it. The candidate browser calls the engine for a short-lived,
single-room token; no LiveKit secret is exposed to the browser.

## 3. Add the `voice-agent` Railway service

Create a new service from the same repository and configure:

- Root directory: `/interview-engine/apps/voice-agent`
- Dockerfile path: `/interview-engine/apps/voice-agent/Dockerfile`
- Start command: leave empty; use the Dockerfile command
- Public networking/domain: none
- Healthcheck: none
- Restart policy: always/on failure

Set:

```text
LIVEKIT_URL=wss://<project>.livekit.cloud
LIVEKIT_API_KEY=<same livekit api key>
LIVEKIT_API_SECRET=<same livekit api secret>
LIVEKIT_AGENT_NAME=interviehire-interviewer
DEEPGRAM_API_KEY=<your Deepgram key>
CARTESIA_API_KEY=<your Cartesia key>
CARTESIA_VOICE_ID=<chosen Cartesia voice id>
CARTESIA_MODEL=sonic-3
ENGINE_INTERNAL_URL=http://${{engine.RAILWAY_PRIVATE_DOMAIN}}:4000
INTERNAL_SERVICE_SECRET=<exact same value as engine>
INTERVIEW_HARD_LIMIT_SECONDS=1800
INTERVIEW_CLOSING_RESERVE_SECONDS=45
PORT=8081
```

`ENGINE_INTERNAL_URL` must use Railway private networking and must not end in
`/api` or `/internal`; the worker appends its internal route paths.

## 4. Candidate web on Vercel

No new Vercel secret is required. Keep `NEXT_PUBLIC_API_URL` pointed at the
public Railway engine domain and redeploy the candidate-room project so it
contains `livekit-client`.

## 5. Roll out per job

Open the dashboard job's Interview Settings and enable "Conversational AI
voice interview", then save. Jobs default to the static question-list flow
until explicitly opted in.

There's no cap on blueprint size or follow-up count — the director paces
itself using the time and topic-count context it's given each turn (see
`interview-conversation.service.ts`), preferring follow-ups when there's time
to spare and moving on as the 30-minute hard deadline or the remaining
question list gets tight. The interview starts closing near the deadline and
force-ends the room at 30 minutes regardless of where the conversation is.

## 6. Smoke test

In Railway logs, confirm the worker registered with the agent name and accepted
a job. Start a test interview and verify:

1. Lina asks the first prepared question.
2. Candidate and interviewer transcripts appear in the room.
3. A weak or incomplete answer gets a relevant follow-up; a real request to
   repeat/clarify gets the question re-asked (not silently skipped).
4. The next prepared question is asked verbatim once the director moves on.
5. Ending the call completes the session and produces the report.

Keep the feature off for other jobs until these checks pass in production;
disabling "Conversational AI voice interview" on a job is the rollback (it
falls straight back to the static question-list flow).
