// Legacy role-template question generator. Kept only as the keyless seed used by
// enrichJobWithAI at job creation (ai-api.js); the old Question Studio render path
// was removed when the Interview Blueprint Studio (blueprint-studio.js) replaced it.

interface QuestionSourceJob {
  roleName?: string;
  cardName?: string;
  description?: string;
  resumeCriteria?: {
    mustHave?: string[];
    goodToHave?: string[];
  };
}

interface GeneratedQuestion {
  id: string;
  type: "technical" | "behavioral" | "situational";
  question: string;
  difficulty: "beginner" | "intermediate" | "advanced";
  rubric: string;
  follow_ups: string[];
}

const VOICE_QUESTION_MAX_WORDS = 26;

function conciseFocus(value: string, maxWords = 12): string {
  const source = value.replace(/\ball aspects of\b/gi, '').replace(/\s+/g, ' ').replace(/[.;:]+$/, '').trim();
  const parts = source.split(/,\s*/).filter(Boolean);
  const selected: string[] = [];
  for (const part of parts) {
    const candidate = [...selected, part].join(', ');
    if (selected.length && candidate.split(/\s+/).length > maxWords) break;
    selected.push(part);
  }
  return (selected.join(', ') || source).split(/\s+/).slice(0, maxWords).join(' ')
    .replace(/\b(?:and|or|with|while|to|for|of|in|the)\s*$/i, '').replace(/[,.]+$/, '').trim() || 'this role requirement';
}

function voiceQuestion(requirement: string): string {
  const focus = conciseFocus(requirement);
  const action = /^(?:manage|oversee|ensure|lead|coordinate|develop|design|maintain|prepare|conduct|perform|deliver|implement|support|assess|plan|create|build|review|monitor|supervise)\b/i.test(focus);
  const subject = action ? `a time you had to ${focus[0].toLowerCase()}${focus.slice(1)}` : `your experience with ${focus}`;
  return `Tell me about ${subject}. What was the outcome?`;
}

function isVoiceQuestionLength(value: unknown): boolean {
  return typeof value === 'string' && value.trim().split(/\s+/).filter(Boolean).length <= VOICE_QUESTION_MAX_WORDS;
}

function generateQuestionsLocally(job: QuestionSourceJob): GeneratedQuestion[] {
  const clean = (value: unknown): string => typeof value === 'string' ? value.trim() : '';
  const dedupe = (values: unknown[]): string[] => [...new Set(values.map(clean).filter(Boolean))];
  const configured = dedupe([
    ...(job.resumeCriteria?.mustHave || []),
    ...(job.resumeCriteria?.goodToHave || []),
  ]);
  const jdClauses = clean(job.description)
    .split(/\n+|[.;]\s+/)
    .map((line) => line.replace(/^\s*[-*\d.)]+\s*/, '').trim())
    .filter((line) => line.length >= 12 && line.length <= 180);
  const role = clean(job.roleName) || clean(job.cardName) || 'this role';
  const requirements = dedupe([...configured, ...jdClauses]);
  if (!requirements.length) requirements.push(`the core responsibilities of ${role}`);

  // Five legacy seeds are still required by the old job-creation contract, but
  // their content is now entirely derived from this job rather than title-based
  // software/product/general templates.
  return Array.from({ length: 5 }, (_, index): GeneratedQuestion => {
    const requirement = requirements[index % requirements.length];
    const difficulty: GeneratedQuestion['difficulty'] = index === 0 ? 'beginner' : index === 4 ? 'advanced' : 'intermediate';
    const type: GeneratedQuestion['type'] = index === 4 ? 'situational' : index >= 2 ? 'behavioral' : 'technical';
    return {
      id: `q-gen-${index + 1}`,
      type,
      question: voiceQuestion(requirement),
      difficulty,
      rubric: `Look for first-hand, role-relevant evidence of ${requirement}, the candidate's specific responsibility, sound judgment, and a clear outcome. Do not reward generic theory without an example.`,
      follow_ups: [
        `What decision did you personally make while applying ${requirement}?`,
        'What evidence showed that your approach worked?',
      ],
    };
  });
}

// Render the Questions Pane for a specific job

export { generateQuestionsLocally, isVoiceQuestionLength };
