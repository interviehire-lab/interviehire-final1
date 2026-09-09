// effective-questions — resolves the question set actually in effect for a
// session.
//
// NOTE: this module is referenced by evaluation.service, aviral-evaluation.service
// and interview-conversation.service but was missing from the source checkout
// (the three importers exist, the file did not). Reconstructed from its call
// sites: each caller does `getEffectiveQuestions(session) as QuestionWithGuidance[]`
// where the session is loaded with
//   jobRole: { include: { questions: { where: { isActive: true }, orderBy: { createdAt: 'asc' } } } }
// so the "effective" questions are the role's active, authored questions. When a
// role has no authored questions yet, build a small role-derived fallback so an
// interview can still run without silently turning every role into a software
// engineering interview.

type EffectiveQuestion = {
  id: string;
  text: string;
  difficulty: 'EASY' | 'MEDIUM' | 'HARD';
  topicCategories: string[];
  aiEvaluationGuidance: string;
  estimatedMinutes?: number;
};

const VOICE_QUESTION_MAX_WORDS = 26;

function wordCount(value: string): number {
  return value.trim().split(/\s+/).filter(Boolean).length;
}

function conciseFocus(value: string, maxWords = 12): string {
  const source = value.replace(/\ball aspects of\b/gi, '').replace(/\s+/g, ' ').replace(/[.;:]+$/, '').trim();
  const parts = source.split(/,\s*/).filter(Boolean);
  const selected: string[] = [];
  for (const part of parts) {
    const candidate = [...selected, part].join(', ');
    if (selected.length && wordCount(candidate) > maxWords) break;
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

function voiceSafeAuthoredQuestions(questions: EffectiveQuestion[]): EffectiveQuestion[] {
  let changed = false;
  const safe = questions.map((question) => {
    if (wordCount(question.text) <= VOICE_QUESTION_MAX_WORDS) return question;
    try {
      const guidance = JSON.parse(question.aiEvaluationGuidance || '{}') as Record<string, unknown>;
      if (guidance.edited === true) return question;
      const source = typeof guidance.targetRequirement === 'string' && guidance.targetRequirement.trim()
        ? guidance.targetRequirement
        : typeof guidance.competency === 'string' && guidance.competency.trim()
          ? guidance.competency
          : '';
      if (!source) return question;
      changed = true;
      return { ...question, text: voiceQuestion(source) };
    } catch {
      return question;
    }
  });
  return changed ? safe : questions;
}

// A rubric-shaped guidance blob parsed by the consuming services.
function guidance(modelAnswer: string, points: string[], redFlags: string[] = []): string {
  return JSON.stringify({
    modelAnswer,
    rubric: {
      requiredPoints: points.map((description, i) => ({ id: `p${i + 1}`, description, weight: 1 })),
      redFlags: redFlags.map((description) => ({ description })),
    },
  });
}

function roleDerivedFallback(session: unknown): EffectiveQuestion[] {
  const role = (session as {
    jobRole?: { title?: string; description?: string; requirements?: string; primaryCriteria?: string[]; secondaryCriteria?: string[] };
  } | null)?.jobRole;
  const title = role?.title?.trim() || 'this role';
  const criteria = [...(role?.primaryCriteria ?? []), ...(role?.secondaryCriteria ?? [])]
    .map((item) => String(item).trim())
    .filter(Boolean);
  const focus = criteria.slice(0, 4);
  const topicCategories = focus.length ? focus : [title];
  const roleEvidence = [role?.description, role?.requirements, ...focus].filter(Boolean).join('; ');

  return [
    {
      id: 'role-derived-q1',
      text: `What experience has prepared you to succeed as ${title}? Please connect your answer to the role's main responsibilities.`,
      difficulty: 'EASY',
      topicCategories,
      estimatedMinutes: 4,
      aiEvaluationGuidance: guidance(
        `Relevant evidence of experience against the advertised ${title} responsibilities: ${roleEvidence || title}.`,
        ['Gives specific relevant experience', 'Connects that experience to the advertised role', 'Explains their own contribution'],
      ),
    },
    {
      id: 'role-derived-q2',
      text: `Describe a challenging piece of work relevant to ${title}. How did you approach it, and what was the outcome?`,
      difficulty: 'MEDIUM',
      topicCategories,
      estimatedMinutes: 5,
      aiEvaluationGuidance: guidance(
        `A concrete example relevant to ${title}, with a sound approach, clear personal contribution, and an evidenced outcome.`,
        ['Describes a relevant challenge', 'Explains the approach and personal contribution', 'States a clear outcome'],
      ),
    },
    {
      id: 'role-derived-q3',
      text: `Using the requirements for ${title}, how would you handle a realistic high-priority task in this role? Explain your decisions and how you would judge success.`,
      difficulty: 'MEDIUM',
      topicCategories,
      estimatedMinutes: 5,
      aiEvaluationGuidance: guidance(
        `A role-appropriate approach grounded in these advertised requirements: ${roleEvidence || title}.`,
        ['Uses the advertised requirements', 'Explains decisions and priorities', 'Defines a relevant measure of success'],
      ),
    },
  ];
}

/**
 * Returns the questions in effect for an interview session: the role's active
 * authored questions, falling back to questions derived from that role when none
 * are authored.
 * `session` is the Prisma InterviewSession loaded with `jobRole.questions`.
 */
export function getEffectiveQuestions(session: unknown): EffectiveQuestion[] {
  const roleQuestions = (session as { jobRole?: { questions?: EffectiveQuestion[] } } | null)?.jobRole?.questions;
  if (Array.isArray(roleQuestions) && roleQuestions.length > 0) {
    return voiceSafeAuthoredQuestions(roleQuestions);
  }
  return roleDerivedFallback(session);
}
