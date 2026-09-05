#!/usr/bin/env node
// A proper multi-service dev log viewer, replacing plain `tail -F`.
//
// Every local service logs in a different shape (Fastify/pino-pretty,
// uvicorn, Next.js dev, and even raw pino NDJSON from LiveKit's native
// bridge) — this normalizes all of them into one aligned stream with a real
// timestamp, a normalized level (INFO / WARNING / ERROR / DEBUG / OTHER),
// the service name, and — the actual point of writing this instead of
// reaching for `tail -F` — Fastify's per-request JSON payload turned into
// readable text instead of a raw compact JSON blob.
//
// Usage: node log-viewer.mjs --dir <logDir> [--lines N] service1 service2 ...

import fs from 'node:fs';
import path from 'node:path';

const POLL_MS = 200;

const RESET = '\x1b[0m';
const DIM = '\x1b[2m';
const COLOR = {
  cyan: '\x1b[1;36m', yellow: '\x1b[1;33m', magenta: '\x1b[1;35m',
  green: '\x1b[1;32m', blue: '\x1b[1;34m', red: '\x1b[1;31m',
  gray: '\x1b[90m', white: '\x1b[97m',
  timeColor: '\x1b[2;36m', // muted cyan — distinct from level/service colors, but quieter than either
};

const SERVICE_COLORS = {
  'interview-api': COLOR.cyan,
  'voice-agent': COLOR.yellow,
  'fastapi-backend': COLOR.magenta,
  'candidate-web': COLOR.green,
  'dashboard': COLOR.blue,
};
const FALLBACK_SERVICE_COLORS = [COLOR.white, COLOR.gray];

const LEVEL_ORDER = ['ERROR', 'WARNING', 'INFO', 'DEBUG', 'OTHER'];
const LEVEL_STYLE = {
  ERROR: COLOR.red,
  WARNING: COLOR.yellow,
  INFO: COLOR.green,
  DEBUG: COLOR.gray,
  OTHER: RESET,
};
const LEVEL_WIDTH = Math.max(...LEVEL_ORDER.map((l) => l.length)); // 'WARNING' = 7

// pino's own numeric levels (https://getpino.io/#/docs/api?id=levels)
const PINO_NUMERIC_LEVEL = { 10: 'DEBUG', 20: 'DEBUG', 30: 'INFO', 40: 'WARNING', 50: 'ERROR', 60: 'ERROR' };

function normalizeLevel(raw) {
  const s = String(raw ?? '').trim().toUpperCase();
  if (['ERROR', 'ERR', 'CRIT', 'CRITICAL', 'FATAL'].includes(s)) return 'ERROR';
  if (['WARN', 'WARNING'].includes(s)) return 'WARNING';
  if (['INFO', 'NOTICE'].includes(s)) return 'INFO';
  if (['DEBUG', 'TRACE', 'VERBOSE'].includes(s)) return 'DEBUG';
  return 'OTHER';
}

function pad(n, width = 2) {
  return String(n).padStart(width, '0');
}

function localTimeNow() {
  const d = new Date();
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`;
}

// Best-effort: turn "<date> <time> <offset>" or a bare "<time>" (assumed
// today, local) into our own HH:MM:SS.mmm — so every row lines up on the
// same clock regardless of which format the underlying process printed.
function localTimeFrom(raw, hasDate) {
  const parsed = hasDate ? new Date(raw.replace(' ', 'T').replace(/ ([+-]\d{2}):?(\d{2})$/, '$1$2').replace(/ ([+-]\d{4})$/, '$1')) : null;
  if (parsed && !Number.isNaN(parsed.getTime())) return localTimeFrom_fromDate(parsed);
  // Bare "HH:MM:SS.mmm" — already local wall-clock time as printed by the
  // source process; just normalize the width.
  const m = /^(\d{1,2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?$/.exec(raw.trim());
  if (m) return `${pad(m[1])}:${m[2]}:${m[3]}.${pad(m[4] ?? '0', 3)}`;
  return localTimeNow();
}
function localTimeFrom_fromDate(d) {
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`;
}

// Recursively flatten an object into logfmt-style `key=value` pairs (dotted
// paths for nesting) — the generic fallback for any JSON payload that isn't
// one of the specifically-recognized shapes below.
function flattenLogfmt(value, prefix, pairs) {
  if (value === null || value === undefined) return pairs;
  if (typeof value !== 'object') {
    pairs.push(`${prefix}=${JSON.stringify(value)}`);
    return pairs;
  }
  if (Array.isArray(value)) {
    const allPrimitive = value.every((v) => v === null || typeof v !== 'object');
    if (value.length === 0) pairs.push(`${prefix}=[]`);
    else if (allPrimitive && value.length <= 6) pairs.push(`${prefix}=[${value.map((v) => JSON.stringify(v)).join(',')}]`);
    else pairs.push(`${prefix}=<${value.length} item(s)>`);
    return pairs;
  }
  for (const [k, v] of Object.entries(value)) flattenLogfmt(v, prefix ? `${prefix}.${k}` : k, pairs);
  return pairs;
}

// Fastify's request logger emits a `req` object on the "incoming request"
// line and a `res`/`responseTime` on "request completed" — recognize both
// shapes and render them like a normal HTTP access log line instead of
// dumping the JSON. Anything else just gets flattened generically.
function formatExtra(extra) {
  if (extra && typeof extra === 'object' && !Array.isArray(extra)) {
    if (extra.req && typeof extra.req === 'object' && extra.req.method && extra.req.url) {
      return `→ ${extra.req.method} ${extra.req.url}`; // →
    }
    if (extra.res && typeof extra.res === 'object' && 'statusCode' in extra.res) {
      const ms = typeof extra.responseTime === 'number' ? `${extra.responseTime.toFixed(1)}ms` : extra.responseTime;
      return `← ${extra.res.statusCode}${ms ? ` (${ms})` : ''}`; // ←
    }
  }
  const pairs = flattenLogfmt(extra, '', []);
  return pairs.length ? pairs.join(' ') : null;
}

// If `text` is "<message> {<json>}", split it — this is exactly the shape
// pino-pretty's singleLine mode produces (interview-api's own logger).
function splitTrailingJson(text) {
  const idx = text.indexOf('{');
  if (idx === -1) return { message: text, extra: null };
  const candidate = text.slice(idx).trim();
  try {
    return { message: text.slice(0, idx).trim(), extra: JSON.parse(candidate) };
  } catch {
    return { message: text, extra: null };
  }
}

// -- Per-line parsers, tried in order -----------------------------------

// [2026-09-05 19:51:20.820 +0530] INFO: message {...}
const PINO_DATED_RE = /^\[(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3} [+-]\d{2}:?\d{2})\]\s+(\w+):\s?(.*)$/;
// [19:51:20.470] WARN (88694): message
const PINO_TIME_PID_RE = /^\[(\d{2}:\d{2}:\d{2}\.\d{3})\]\s+(\w+)\s+\((\d+)\):\s?(.*)$/;
// INFO:     message   (uvicorn / Python logging, no timestamp)
const UVICORN_RE = /^(INFO|WARNING|ERROR|CRITICAL|DEBUG):\s{2,}(.*)$/;
// Next.js CLI's own status glyphs
const NEXT_GLYPH_RE = /^\s*([✓⚠⨯○●])\s?(.*)$/;
// npm's own CLI output (e.g. a service crashing out from under `npm run dev`)
const NPM_RE = /^npm (error|warn)\s+(.*)$/;

function parseLine(line) {
  let m;
  if ((m = PINO_DATED_RE.exec(line))) {
    const { message, extra } = splitTrailingJson(m[3]);
    return { time: localTimeFrom(m[1], true), level: normalizeLevel(m[2]), message, extra, continuable: false };
  }
  if ((m = PINO_TIME_PID_RE.exec(line))) {
    const { message, extra } = splitTrailingJson(m[4]);
    return { time: localTimeFrom(m[1], false), level: normalizeLevel(m[2]), message: `${message} ${DIM}(pid ${m[3]})${RESET}`, extra, continuable: true };
  }
  const trimmed = line.trim();
  if (trimmed.startsWith('{')) {
    try {
      const obj = JSON.parse(trimmed);
      if (typeof obj.level === 'number' || typeof obj.msg === 'string') {
        const level = typeof obj.level === 'number' ? (PINO_NUMERIC_LEVEL[obj.level] ?? 'OTHER') : normalizeLevel(obj.level);
        const time = typeof obj.time === 'number' ? localTimeFrom_fromDate(new Date(obj.time)) : localTimeNow();
        const { level: _l, time: _t, msg, ...rest } = obj;
        return { time, level, message: msg ?? '(no message)', extra: Object.keys(rest).length ? rest : null, continuable: false };
      }
    } catch {
      /* not JSON after all — fall through */
    }
  }
  if ((m = UVICORN_RE.exec(line))) {
    return { time: localTimeNow(), level: normalizeLevel(m[1]), message: m[2], extra: null, continuable: false };
  }
  if ((m = NEXT_GLYPH_RE.exec(line))) {
    const level = m[1] === '⨯' ? 'ERROR' : m[1] === '⚠' ? 'WARNING' : 'INFO'; // ⨯ / ⚠ / ✓,○,●
    return { time: localTimeNow(), level, message: m[2] || line.trim(), extra: null, continuable: false };
  }
  if ((m = NPM_RE.exec(line))) {
    return { time: localTimeNow(), level: m[1] === 'error' ? 'ERROR' : 'WARNING', message: m[2], extra: null, continuable: false };
  }
  // Indented, no recognizable header — a continuation of a multi-line pino
  // entry (voice-agent's own logger doesn't use singleLine mode).
  if (/^\s{2,}\S/.test(line)) {
    return { continuation: line.trim() };
  }
  if (!trimmed) return null; // swallow blank separator lines
  return { time: localTimeNow(), level: 'OTHER', message: trimmed, extra: null, continuable: false };
}

// -- Rendering -------------------------------------------------------------

function centerPad(str, width) {
  const total = width - str.length;
  if (total <= 0) return str;
  const left = Math.floor(total / 2);
  return ' '.repeat(left) + str + ' '.repeat(total - left);
}

function renderEntry(service, serviceColor, serviceWidth, entry) {
  const levelLabel = entry.level.padEnd(LEVEL_WIDTH);
  const levelColor = LEVEL_STYLE[entry.level] ?? RESET;
  const svc = centerPad(service, serviceWidth);
  let line = `${COLOR.timeColor}${entry.time}${RESET}  ${levelColor}${levelLabel}${RESET}  ${serviceColor}[${svc}]${RESET}  ${entry.message}`;
  const extraText = entry.extra != null ? formatExtra(entry.extra) : null;
  if (extraText) line += `  ${DIM}${extraText}${RESET}`;
  // voice-agent's pino logger puts every extra field on its own indented
  // source line (jobId, resuming, agentName, ...) instead of pino-pretty's
  // singleLine JSON — fold them onto the same line as the header, same as
  // Fastify's `extra` above, instead of one blank-service-column row per
  // field (which also can't be kept aligned with the header row above it).
  if (entry.continuationLines?.length) line += `  ${DIM}${entry.continuationLines.join('  ')}${RESET}`;
  process.stdout.write(line + '\n');
}

class Tailer {
  constructor(service, filePath, serviceColor, serviceWidth, tailLines) {
    this.service = service;
    this.filePath = filePath;
    this.serviceColor = serviceColor;
    this.serviceWidth = serviceWidth;
    this.offset = 0;
    this.carry = '';
    this.openEntry = null;

    const stat = fs.statSync(filePath);
    const initial = fs.readFileSync(filePath, 'utf8');
    const lines = initial.split('\n');
    if (lines.length && lines[lines.length - 1] === '') lines.pop();
    for (const line of lines.slice(-tailLines)) this.consume(line);
    this.flush();
    this.offset = stat.size;

    this.interval = setInterval(() => this.poll(), POLL_MS);
  }

  poll() {
    let stat;
    try {
      stat = fs.statSync(this.filePath);
    } catch {
      return; // file momentarily missing (e.g. mid-restart) — just wait
    }
    if (stat.size < this.offset) {
      // Truncated (start_process re-truncates the log on every restart) —
      // start reading from the top again instead of erroring on a negative range.
      this.offset = 0;
      this.carry = '';
    }
    if (stat.size === this.offset) return;
    const fd = fs.openSync(this.filePath, 'r');
    const length = stat.size - this.offset;
    const buf = Buffer.alloc(length);
    fs.readSync(fd, buf, 0, length, this.offset);
    fs.closeSync(fd);
    this.offset = stat.size;
    const text = this.carry + buf.toString('utf8');
    const lines = text.split('\n');
    this.carry = lines.pop() ?? '';
    for (const line of lines) this.consume(line);
    this.flush();
  }

  consume(rawLine) {
    // Strip ANSI color codes before parsing (uvicorn/pino/next all colorize
    // their own output) — we re-color everything ourselves for a consistent
    // look, and raw escape codes would break the regexes above.
    // eslint-disable-next-line no-control-regex
    const line = rawLine.replace(/\x1b\[[0-9;]*m/g, '');
    const parsed = parseLine(line);
    if (!parsed) return;
    if (parsed.continuation !== undefined) {
      if (this.openEntry) this.openEntry.continuationLines.push(parsed.continuation);
      return;
    }
    this.flush();
    this.openEntry = { ...parsed, continuationLines: [] };
    if (!parsed.continuable) this.flush();
  }

  flush() {
    if (!this.openEntry) return;
    renderEntry(this.service, this.serviceColor, this.serviceWidth, this.openEntry);
    this.openEntry = null;
  }

  stop() {
    clearInterval(this.interval);
  }
}

function parseArgs(argv) {
  const args = { dir: null, lines: 200, services: [] };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--dir') args.dir = argv[++i];
    else if (argv[i] === '--lines') args.lines = Number(argv[++i]) || 200;
    else args.services.push(argv[i]);
  }
  return args;
}

function main() {
  const { dir, lines, services } = parseArgs(process.argv.slice(2));
  if (!dir || services.length === 0) {
    process.stderr.write('Usage: log-viewer.mjs --dir <logDir> [--lines N] service1 [service2 ...]\n');
    process.exit(2);
  }
  const useColor = process.stdout.isTTY;
  if (!useColor) {
    // Redirected to a file/pipe — don't pollute it with escape codes.
    for (const key of Object.keys(COLOR)) COLOR[key] = '';
    for (const key of Object.keys(SERVICE_COLORS)) SERVICE_COLORS[key] = '';
  }

  const serviceWidth = Math.max(...services.map((s) => s.length));
  const tailers = [];
  let started = 0;
  services.forEach((service, i) => {
    const filePath = path.join(dir, `${service}.log`);
    if (!fs.existsSync(filePath)) {
      process.stderr.write(`\x1b[1;33mSkipping ${service}: ${filePath} does not exist.\x1b[0m\n`);
      return;
    }
    const color = useColor ? (SERVICE_COLORS[service] ?? FALLBACK_SERVICE_COLORS[i % FALLBACK_SERVICE_COLORS.length]) : '';
    tailers.push(new Tailer(service, filePath, color, serviceWidth, lines));
    started++;
  });

  if (started === 0) {
    process.stderr.write('\x1b[1;31mERROR: No local service logs were found. Run scripts/start-local.sh first.\x1b[0m\n');
    process.exit(1);
  }

  process.stderr.write(`\x1b[1;34mFollowing ${started} local service log(s). Press Ctrl+C to stop.\x1b[0m\n`);

  const shutdown = () => {
    for (const t of tailers) t.stop();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main();
