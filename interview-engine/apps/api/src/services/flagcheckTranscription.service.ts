/**
 * flagcheckTranscription.service
 * ------------------------------
 * Server side of the transcript flagcheck. Persists the live transcription to a
 * plain `.txt` file per session, then runs a THOROUGH AI-tone analysis on that
 * file to estimate whether the candidate is reciting an AI-generated answer
 * rather than speaking spontaneously.
 *
 *   Tier 1 (heuristics): deterministic speech-texture scoring from the shared
 *                        `analyzeAiToneHeuristics` (disfluency absence, textbook
 *                        structure, LLM boilerplate, enumeration cadence).
 *   Tier 2 (semantic):   a DeepSeek -> Gemini pass that judges whether the prose
 *                        reads like a generated answer read aloud. Mirrors the
 *                        provider plumbing + conservative calibration of
 *                        ai-authorship.service.
 *
 * Probabilistic, text-only inference — never proof of misconduct.
 */
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { callDeepSeekJson } from './deepseek.service.js';
import { callGeminiJson } from './gemini.service.js';
import {
  analyzeAiToneHeuristics,
  blendAiToneAssessment,
  FLAGCHECK_DISCLAIMER,
  type AiToneAssessment,
  type AiToneConfidence,
} from '@interviehire/shared';

export { FLAGCHECK_DISCLAIMER };

/** Directory where per-session transcript .txt files are written. */
export const TRANSCRIPTS_DIR = path.resolve(process.cwd(), 'transcripts');

/** Max characters of transcript sent to the LLM, to bound token cost. */
const LLM_TEXT_CHAR_LIMIT = 8000;

type RawAiToneResponse = {
  probability?: number;
  confidence?: AiToneConfidence;
  reasons?: string[];
};

function hasConfiguredKey(value: string | undefined): boolean {
  return Boolean(value && value !== 'replace-me');
}

function normalizeConfidence(value: AiToneConfidence | undefined): AiToneConfidence {
  return value === 'high' || value === 'medium' ? value : 'low';
}

function sanitizeSessionId(sessionId: string): string {
  // Keep file names safe regardless of id format.
  return sessionId.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 120) || 'session';
}

/** Absolute path of the .txt transcript file for a session. */
export function transcriptFilePath(sessionId: string): string {
  return path.join(TRANSCRIPTS_DIR, `${sanitizeSessionId(sessionId)}.txt`);
}

/**
 * Persist the full live transcription to `transcripts/<sessionId>.txt`,
 * overwriting on each save (the client sends the whole transcript so far).
 * Returns the file path.
 */
export async function saveTranscriptFile(sessionId: string, fullText: string): Promise<string> {
  await fsp.mkdir(TRANSCRIPTS_DIR, { recursive: true });
  const filePath = transcriptFilePath(sessionId);
  await fsp.writeFile(filePath, fullText ?? '', 'utf8');
  return filePath;
}

/**
 * Run the full flagcheck on a saved transcript file. Always runs the deterministic
 * heuristics; runs the LLM semantic pass only when `runLlm` is true (the route
 * gates this so the 5s saves don't call the LLM on every tiny delta).
 */
export async function flagcheckTranscriptFile(
  filePath: string,
  options: { runLlm?: boolean } = {},
): Promise<AiToneAssessment> {
  let text = '';
  try {
    text = await fsp.readFile(filePath, 'utf8');
  } catch (error) {
    console.error('Flagcheck could not read transcript file.', error);
  }

  const heuristic = analyzeAiToneHeuristics(text);
  if (!options.runLlm) return heuristic;

  const semantic = await analyzeAiToneWithLlm(text);
  if (!semantic) return heuristic;

  return blendAiToneAssessment(heuristic, semantic.result, semantic.provider);
}

/**
 * Tier 2: ask the LLM whether the transcript reads like a candidate reciting an
 * AI-generated answer. DeepSeek first, Gemini fallback, null if neither is
 * configured or both fail (heuristics still stand on their own).
 */
export async function analyzeAiToneWithLlm(
  rawText: string,
): Promise<{ provider: 'deepseek' | 'gemini'; result: { probability: number; confidence: AiToneConfidence; reasons: string[] } } | null> {
  const text = (rawText ?? '').trim();
  if (text.split(/\s+/).filter(Boolean).length < 25) return null;

  const clipped = text.length > LLM_TEXT_CHAR_LIMIT ? text.slice(-LLM_TEXT_CHAR_LIMIT) : text;

  const systemInstruction = [
    'You analyze a transcript of a candidate speaking aloud during a live job interview.',
    'Judge whether the candidate appears to be READING OR RECITING AN AI-GENERATED ANSWER rather than speaking spontaneously.',
    'Spontaneous speech has disfluencies (um, uh, restarts, self-corrections), informal and uneven phrasing,',
    'tangents, and concrete answer-specific or personal detail.',
    'AI-generated answers read aloud sound unusually polished: textbook structure (firstly/secondly/in conclusion),',
    'generic completeness, even cadence, boilerplate connectives ("it is important to note", "plays a crucial role"),',
    'exhaustive enumeration, near-zero fillers, and little personal or situation-specific reasoning.',
    'This is an uncertain, text-only inference and is NEVER proof of misconduct.',
    'Do NOT raise the probability merely because the answer is correct, concise, formal, or uses technical vocabulary.',
    'Speech-to-text transcripts often lack punctuation and capitalization — do not treat that as evidence either way.',
    'Return strict JSON only.',
  ].join(' ');

  const prompt = [
    'Estimate the likelihood (0-100) that this transcript is being recited from an AI-generated answer.',
    '',
    'Calibration:',
    '- 0-20: reads like natural spontaneous speech.',
    '- 21-49: somewhat polished but plausibly spontaneous.',
    '- 50-74: several notable AI-tone indicators, still uncertain.',
    '- 75-100: strongly reads like recited generated prose; never call it proof.',
    '- Give 2-4 short reasons grounded only in speech texture, each under 14 words.',
    '',
    `Transcript:\n"""\n${clipped}\n"""`,
    '',
    'Return JSON only:',
    JSON.stringify({ probability: 0, confidence: 'high | medium | low', reasons: ['short texture-based reason'] }),
  ].join('\n');

  if (hasConfiguredKey(process.env.DEEPSEEK_API_KEY)) {
    try {
      const response = await callDeepSeekJson<RawAiToneResponse>({
        systemInstruction,
        prompt,
        maxOutputTokens: Number(process.env.DEEPSEEK_FLAGCHECK_MAX_TOKENS || 1200),
        temperature: 0.1,
      });
      return { provider: 'deepseek', result: normalizeAiToneResponse(response) };
    } catch (error) {
      console.error('DeepSeek AI-tone flagcheck failed.', error);
    }
  }

  if (hasConfiguredKey(process.env.GEMINI_API_KEY)) {
    try {
      const response = await callGeminiJson<RawAiToneResponse>({
        systemInstruction,
        prompt,
        model: process.env.GEMINI_FLAGCHECK_MODEL || process.env.GEMINI_EVALUATION_MODEL,
        maxOutputTokens: Number(process.env.GEMINI_FLAGCHECK_MAX_TOKENS || 1200),
        temperature: 0.1,
      });
      return { provider: 'gemini', result: normalizeAiToneResponse(response) };
    } catch (error) {
      console.error('Gemini AI-tone flagcheck failed.', error);
    }
  }

  return null;
}

function normalizeAiToneResponse(response: RawAiToneResponse): { probability: number; confidence: AiToneConfidence; reasons: string[] } {
  const probability = Math.max(0, Math.min(100, Math.round(Number(response?.probability) || 0)));
  const reasons = (response?.reasons ?? [])
    .map((reason) => String(reason).trim())
    .filter(Boolean)
    .slice(0, 4);

  return {
    probability,
    confidence: normalizeConfidence(response?.confidence),
    reasons: reasons.length ? reasons : ['Insufficient distinctive texture for a reliable assessment.'],
  };
}
