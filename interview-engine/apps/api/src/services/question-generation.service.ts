import { callDeepSeekJson } from './deepseek.service.js';

type GeneratedQuestion = {
  text: string;
  difficulty: 'EASY' | 'MEDIUM' | 'HARD';
  topicCategories: string[];
  aiEvaluationGuidance: string;
};

type DeepSeekQuestionResponse = {
  questions: Array<{
    text: string;
    difficulty?: 'EASY' | 'MEDIUM' | 'HARD';
    topicCategories?: string[];
    questionType?: string;
    modelAnswer: string;
    rubric?: {
      requiredPoints?: Array<{ id?: string; description: string; keywords?: string[]; weight?: number }>;
      secondaryPoints?: Array<{ id?: string; description: string; keywords?: string[]; weight?: number }>;
      excellentAnswerSignals?: Array<{ id?: string; description: string; keywords?: string[]; weight?: number }>;
      redFlags?: Array<{ id?: string; description: string; severity?: 'low' | 'medium' | 'high' | 'critical' }>;
    };
  }>;
};

const VOICE_QUESTION_MAX_WORDS = 26;

function wordCount(value: string): number {
  return value.trim().split(/\s+/).filter(Boolean).length;
}

function conciseFocus(value: string, maxWords = 12): string {
  const source = value
    .replace(/\ball aspects of\b/gi, '')
    .replace(/\s+/g, ' ')
    .replace(/[.;:]+$/, '')
    .trim();
  const parts = source.split(/,\s*/).filter(Boolean);
  const selected: string[] = [];
  for (const part of parts) {
    const candidate = [...selected, part].join(', ');
    if (selected.length && wordCount(candidate) > maxWords) break;
    selected.push(part);
  }
  return (selected.join(', ') || source)
    .split(/\s+/)
    .slice(0, maxWords)
    .join(' ')
    .replace(/\b(?:and|or|with|while|to|for|of|in|the)\s*$/i, '')
    .replace(/[,.]+$/, '')
    .trim() || 'this role requirement';
}

function voiceQuestion(requirement: string): string {
  const focus = conciseFocus(requirement);
  const action = /^(?:manage|oversee|ensure|lead|coordinate|develop|design|maintain|prepare|conduct|perform|deliver|implement|support|assess|plan|create|build|review|monitor|supervise)\b/i.test(focus);
  const subject = action
    ? `a time you had to ${focus[0].toLowerCase()}${focus.slice(1)}`
    : `your experience with ${focus}`;
  return `Tell me about ${subject}. What was the outcome?`;
}

export async function generateQuestions(input: {roleType: string; jobDescription: string; companyName: string; jobTitle?: string}) {
  const roleTitle = input.jobTitle?.trim() || input.roleType.trim() || 'the advertised role';
  const prompt = [
    `Generate 8 interview questions for ${input.companyName}.`,
    `Role: ${roleTitle}.`,
    `Role classification supplied by the application: ${input.roleType}.`,
    `Job description: ${input.jobDescription}`,
    '',
    'Derive every competency, topic category, question, model answer, and rubric point from the role title and job description above.',
    'Do not assume the role is a software role and do not introduce coding, system design, product, sales, or any other domain unless the job description supports it.',
    'Cover the most important responsibilities and selection criteria in the job description without using a preset competency framework.',
    `Keep each spoken question focused on one idea and at most ${VOICE_QUESTION_MAX_WORDS} words. Put additional probes in later turns rather than making a compound question.`,
    'Each question must include a modelAnswer that can be used as the reference answer during evaluation.',
    'Each rubric must be compact, concept based, and suitable for semantic grading.',
    'Return JSON only in this shape:',
    JSON.stringify({
      questions: [
        {
          text: 'question text',
          difficulty: 'EASY | MEDIUM | HARD',
          topicCategories: ['skill or topic'],
          questionType: 'technical_theory | coding | system_design | behavioral | case_study | sales_roleplay | hr_screening | general | custom',
          modelAnswer: 'reference answer with the important concepts and tradeoffs',
          rubric: {
            requiredPoints: [
              { id: 'stable_snake_case_id', description: 'required concept', keywords: ['keyword'], weight: 30 },
            ],
            secondaryPoints: [],
            excellentAnswerSignals: [],
            redFlags: [
              { id: 'stable_snake_case_id', description: 'incorrect or risky claim', severity: 'medium' },
            ],
          },
        },
      ],
    }),
  ].join('\n');

  try {
    const response = await callDeepSeekJson<DeepSeekQuestionResponse>({
      systemInstruction: 'You are an expert, domain-neutral interview designer. Use only the supplied job information, return strict JSON, and include model answers for every question.',
      prompt,
      maxOutputTokens: Number(process.env.DEEPSEEK_QUESTION_MAX_TOKENS || 8000),
      temperature: 0.25,
    });

    return normalizeGeneratedQuestions(response.questions, roleTitle);
  } catch {
    return buildRoleDerivedQuestions(roleTitle, input.jobDescription);
  }
}

function buildRoleDerivedQuestions(roleTitle: string, jobDescription: string): GeneratedQuestion[] {
  const clauses = [...new Set(jobDescription
    .split(/\n+|[.;]\s+/)
    .map((line) => line.replace(/^\s*[-*\d.)]+\s*/, '').trim())
    .filter((line) => line.length >= 12 && line.length <= 220))]
    .slice(0, 8);
  const requirements = clauses.length
    ? clauses
    : [
        `the responsibilities described for ${roleTitle}`,
        `relevant prior experience for ${roleTitle}`,
        `sound judgment in the day-to-day work of ${roleTitle}`,
      ];

  return requirements.map((requirement, index) => ({
    text: voiceQuestion(requirement),
    difficulty: index === 0 ? 'EASY' : index >= requirements.length - 2 ? 'HARD' : 'MEDIUM',
    topicCategories: [requirement],
    aiEvaluationGuidance: JSON.stringify({
      questionType: 'case_study',
      modelAnswer: `A strong answer gives specific, first-hand evidence of ${requirement}, explains the candidate's decisions and responsibilities, and connects the outcome to the ${roleTitle} role.`,
      rubric: {
        requiredPoints: [
          { id: 'relevant_evidence', description: `Gives concrete evidence of ${requirement}.`, keywords: [], weight: 40 },
          { id: 'personal_contribution', description: 'Explains the candidate’s own decisions and contribution.', keywords: [], weight: 35 },
          { id: 'outcome', description: 'States a clear outcome and what it demonstrates for this role.', keywords: [], weight: 25 },
        ],
        secondaryPoints: [],
        excellentAnswerSignals: [],
        redFlags: [],
      },
    }),
  }));
}

function normalizeGeneratedQuestions(questions: DeepSeekQuestionResponse['questions'] = [], roleTitle = 'this role'): GeneratedQuestion[] {
  return questions
    .filter((question) => question.text?.trim() && question.modelAnswer?.trim())
    .map((question) => {
      const rubric = question.rubric ?? {};

      return {
        text: wordCount(question.text) > VOICE_QUESTION_MAX_WORDS
          ? voiceQuestion(question.topicCategories?.[0] || roleTitle)
          : question.text.trim(),
        difficulty: question.difficulty || 'MEDIUM',
        topicCategories: question.topicCategories?.length ? question.topicCategories : ['role competencies'],
        aiEvaluationGuidance: JSON.stringify({
          questionType: question.questionType || 'general',
          modelAnswer: question.modelAnswer.trim(),
          rubric: {
            requiredPoints: normalizeRubricPoints(rubric.requiredPoints, question.modelAnswer),
            secondaryPoints: normalizeRubricPoints(rubric.secondaryPoints),
            excellentAnswerSignals: normalizeRubricPoints(rubric.excellentAnswerSignals),
            redFlags: (rubric.redFlags ?? []).map((flag, index) => ({
              id: flag.id || `red_flag_${index + 1}`,
              description: flag.description,
              severity: flag.severity || 'medium',
            })).filter((flag) => flag.description?.trim()),
          },
        }),
      };
    });
}

function normalizeRubricPoints(
  points: Array<{ id?: string; description: string; keywords?: string[]; weight?: number }> | undefined,
  fallbackDescription?: string,
) {
  const source = points?.length ? points : fallbackDescription ? [{ description: fallbackDescription, weight: 100 }] : [];

  return source
    .map((point, index) => ({
      id: point.id || `point_${index + 1}`,
      description: point.description,
      keywords: point.keywords ?? [],
      weight: point.weight ?? 25,
    }))
    .filter((point) => point.description?.trim());
}
