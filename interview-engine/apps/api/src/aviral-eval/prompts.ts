import type { CandidateResponseInput, InterviewContext, QuestionEvaluationConfig } from "./types.js";
import { DIMENSION_KEYS, EXIT_DIMENSION_KEYS, getDimensionWeights, normalizeWeights } from "./rubrics.js";
import { inferEvaluationMode } from "./scoring.js";

export function buildRubricExtractionPrompt(question: QuestionEvaluationConfig): string {
  return [
    "Convert the model answer into a structured evaluation rubric.",
    "Do not treat the model answer as the only valid wording. Extract concepts and mistakes.",
    "Return strict JSON only.",
    "",
    `Question: ${question.questionText}`,
    `Question type: ${question.questionType}`,
    `Difficulty: ${question.difficulty ?? "not specified"}`,
    `Model answer: ${question.modelAnswer ?? ""}`,
    "",
    "Required JSON shape:",
    JSON.stringify(
      {
        requiredPoints: [
          {
            id: "short_snake_case_id",
            description: "Concept the candidate must cover.",
            weight: 25,
          },
        ],
        bonusPoints: [
          {
            id: "short_snake_case_id",
            description: "Extra strong answer signal.",
            weight: 10,
          },
        ],
        redFlags: [
          {
            id: "short_snake_case_id",
            description: "Clearly incorrect or risky claim.",
            severity: "low | medium | high | critical",
          },
        ],
        notes: "Any evaluation guidance.",
      },
      null,
      2,
    ),
  ].join("\n");
}

export function buildAnswerEvaluationPrompt(
  context: InterviewContext,
  input: CandidateResponseInput,
): string {
  // Exit interviews are read for feedback, not scored for a hire — use a wholly
  // different judge prompt that extracts sentiment + themes rather than correctness.
  if (context.interviewType === "exit_interview") {
    return buildExitAnswerPrompt(context, input);
  }

  const mode = inferEvaluationMode(input.question);

  if (mode === "followup_contextual") {
    return buildFollowupEvaluationPrompt(context, input);
  }

  const weights = normalizeWeights(
    getDimensionWeights(context.interviewType, input.question.questionType),
  );

  return [
    "Evaluate the candidate response for an interview report.",
    "Use transcript content only. Do not infer tone, audio, video, face, body language, or confidence from non-text signals.",
    "Compare against the model answer by concept, not exact wording. Give credit for equivalent correct ideas.",
    "Penalize factual errors, contradictions, buzzwords, unsupported claims, and non-answers. Do not invent evidence. Keep evidence quotes short.",
    `Score EVERY one of these dimensions (use these EXACT keys) from 0-100: ${Object.keys(weights).join(", ")}.`,
    "For communication_quality, judge from the transcript text alone (consistent with using text-only signals above): English-language proficiency — grammar, vocabulary range, sentence structure, and clarity of expression — alongside how well-organized and articulate the answer is. Penalize responses that are hard to follow due to language errors, not just weak content.",
    "In modelAnswerComparison, list the required model-answer concepts the candidate covered vs missed, any bonus concepts covered, and any incorrect claims.",
    "Return strict JSON only.",
    "",
    `Role: ${context.roleTitle}`,
    `Role level: ${context.roleLevel ?? "not specified"}`,
    `Interview type: ${context.interviewType}`,
    `Must-have skills: ${(context.mustHaveSkills ?? []).join(", ") || "not specified"}`,
    `Nice-to-have skills: ${(context.niceToHaveSkills ?? []).join(", ") || "not specified"}`,
    `Company evaluation notes: ${context.companyEvaluationNotes ?? "none"}`,
    `Question type: ${input.question.questionType}`,
    `Evaluation mode: ${mode}`,
    `Dimension weights: ${JSON.stringify(weights)}`,
    "",
    `Question: ${input.question.questionText}`,
    `Model answer: ${input.question.modelAnswer ?? "not available"}`,
    `Structured model rubric: ${JSON.stringify(input.question.modelAnswerRubric ?? null)}`,
    "",
    `Candidate transcript: ${input.response.transcript}`,
    "",
    "Required JSON shape:",
    getEvaluationJsonShape(mode),
  ].join("\n");
}

export function buildFollowupEvaluationPrompt(
  context: InterviewContext,
  input: CandidateResponseInput,
): string {
  const weights = normalizeWeights(getDimensionWeights(context.interviewType, "followup"));

  return [
    "Evaluate a generated follow-up answer as a continuation of the original answer.",
    "The follow-up should be judged on directness, depth expansion, consistency, adaptability, correctness, and communication.",
    "Use transcript content only. Do not infer audio/video signals.",
    "Return strict JSON only.",
    "",
    `Role: ${context.roleTitle}`,
    `Role level: ${context.roleLevel ?? "not specified"}`,
    `Interview type: ${context.interviewType}`,
    `Dimension weights: ${JSON.stringify(weights)}`,
    "",
    `Original question: ${input.followupContext?.originalQuestionText ?? "not available"}`,
    `Original candidate transcript: ${input.followupContext?.originalTranscript ?? "not available"}`,
    `Generated follow-up question: ${
      input.followupContext?.generatedFollowupQuestion ?? input.question.questionText
    }`,
    `Follow-up candidate transcript: ${input.response.transcript}`,
    "",
    "Required JSON shape:",
    getEvaluationJsonShape("followup_contextual"),
  ].join("\n");
}

// Exit-interview judge prompt. The employee is leaving; we do NOT grade correctness
// or compare to a model answer. We read the emotional valence and mine the answer for
// the theme it speaks to, what they valued, what drove them out, and any serious
// concern. Output reuses the ResponseEvaluation JSON shape (so validation, multi-judge
// merge, and the report renderer all work unchanged) — only the dimension keys and the
// semantics of each field differ.
export function buildExitAnswerPrompt(
  context: InterviewContext,
  input: CandidateResponseInput,
): string {
  const theme = (input.question.skillTags ?? []).join(", ") || "general";

  return [
    "Analyze one answer from an EXIT INTERVIEW with a departing employee.",
    "This is feedback, not a test. Do NOT judge correctness, and do NOT compare to any model answer.",
    "Read the answer for the employee's honest experience. Extract sentiment and themes, and preserve their voice.",
    "Use transcript content only. Do not infer tone from audio/video — only from the words.",
    `Score these EXACT dimension keys from 0-100: ${EXIT_DIMENSION_KEYS.join(", ")}.`,
    "sentiment: 0 = very negative / bitter, 50 = neutral / mixed, 100 = very positive / warm.",
    "candor: how open and honest vs guarded or diplomatic. specificity: concrete detail vs vague generalities.",
    "constructiveness: how actionable the feedback is for the company.",
    "For the sentiment dimension's `evidence`, include ONE short verbatim quote from the transcript that best captures their feeling.",
    "overallScore = the overall sentiment of THIS answer (0-100), same scale as the sentiment dimension.",
    "strengths = things the employee valued or that kept them here. weaknesses = pain points or reasons that contributed to their leaving.",
    "redFlags = serious concerns only (harassment, discrimination, safety, legal exposure, severe burnout, unethical conduct) with severity; otherwise return an empty array. Do NOT flag ordinary dissatisfaction.",
    "followUpRecommendations = concrete retention or process actions the company could take.",
    "Return strict JSON only.",
    "",
    `Company: ${context.roleTitle}`,
    `Theme of this question: ${theme}`,
    "",
    `Question: ${input.question.questionText}`,
    `Employee transcript: ${input.response.transcript}`,
    "",
    "Required JSON shape:",
    getExitEvaluationJsonShape(),
  ].join("\n");
}

function getExitEvaluationJsonShape(): string {
  const dimensionScores = Object.fromEntries(
    EXIT_DIMENSION_KEYS.map((key) => [
      key,
      {
        score: 0,
        reason: "Short reason.",
        evidence: ["Short verbatim quote from the transcript."],
        missing: [],
      },
    ]),
  );

  return JSON.stringify(
    {
      answerId: "answer id from input",
      questionId: "question id from input",
      questionOrigin: "predetermined | generated_followup",
      evaluationMode: "rubric_only",
      overallScore: 0,
      dimensionScores,
      strengths: ["Something the employee valued."],
      weaknesses: ["A pain point or reason for leaving."],
      redFlags: [
        {
          label: "Serious concern label.",
          severity: "low | medium | high | critical",
          reason: "Why this matters.",
        },
      ],
      followUpRecommendations: ["Concrete retention or process action."],
      evaluationConfidence: "high | medium | low",
      summary: "One-paragraph summary of what the employee conveyed.",
      transcriptOnly: true,
    },
    null,
    2,
  );
}

function getEvaluationJsonShape(mode: string): string {
  const dimensionScores = Object.fromEntries(
    DIMENSION_KEYS.map((key) => [
      key,
      {
        score: 0,
        reason: "Short reason.",
        evidence: ["Short transcript evidence."],
        missing: ["Important missing item."],
      },
    ]),
  );

  const baseShape = {
    answerId: "answer id from input",
    questionId: "question id from input",
    questionOrigin: "predetermined | generated_followup",
    evaluationMode: mode,
    overallScore: 0,
    dimensionScores,
    strengths: ["Concrete strength."],
    weaknesses: ["Concrete weakness."],
    redFlags: [
      {
        label: "Red flag label.",
        severity: "low | medium | high | critical",
        reason: "Why this matters.",
      },
    ],
    followUpRecommendations: ["Suggested probe for next round."],
    evaluationConfidence: "high | medium | low",
    summary: "One-paragraph answer summary.",
    transcriptOnly: true,
  };

  if (mode === "followup_contextual") {
    return JSON.stringify(
      {
        ...baseShape,
        followupAnalysis: {
          addressedFollowup: true,
          improvedPreviousAnswer: true,
          contradictedPreviousAnswer: false,
          handledProbeWell: true,
          followupValue: "high | medium | low",
          reason: "What signal the follow-up added.",
        },
      },
      null,
      2,
    );
  }

  return JSON.stringify(
    {
      ...baseShape,
      modelAnswerComparison: {
        coveredRequiredPoints: ["Required point id or description."],
        missedRequiredPoints: ["Required point id or description."],
        coveredBonusPoints: ["Bonus point id or description."],
        incorrectClaims: ["Incorrect claim from transcript."],
      },
    },
    null,
    2,
  );
}
