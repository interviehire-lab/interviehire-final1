import { describe, expect, it } from 'vitest';
import { getEffectiveQuestions } from './effective-questions.js';

describe('getEffectiveQuestions', () => {
  it('keeps authored questions unchanged', () => {
    const authored = [{
      id: 'civil-1',
      text: 'How do you assess soil bearing capacity?',
      difficulty: 'MEDIUM' as const,
      topicCategories: ['geotechnical engineering'],
      aiEvaluationGuidance: '{}',
    }];

    expect(getEffectiveQuestions({ jobRole: { title: 'Civil Engineer', questions: authored } })).toBe(authored);
  });

  it('derives its fallback from the actual role instead of software topics', () => {
    const questions = getEffectiveQuestions({
      jobRole: {
        title: 'Civil Engineer',
        description: 'Plan and supervise construction work.',
        requirements: 'Knowledge of structural safety and site operations.',
        primaryCriteria: ['structural safety', 'site operations'],
        secondaryCriteria: ['project planning'],
        questions: [],
      },
    });

    expect(questions).toHaveLength(3);
    expect(questions.every((question) => question.text.includes('Civil Engineer'))).toBe(true);
    expect(questions.every((question) => question.topicCategories.includes('structural safety'))).toBe(true);
    expect(JSON.stringify(questions).toLowerCase()).not.toMatch(/coding|software|url shortener|data structures/);
  });

  it('shortens a previously synced generated voice question without touching its rubric', () => {
    const requirement = 'Manage all aspects of hotel construction and renovation projects from initiation to completion, ensuring alignment with client vision and scope';
    const guidance = JSON.stringify({ targetRequirement: requirement, competency: requirement, edited: false, rubric: { requiredPoints: [] } });
    const authored = [{
      id: 'construction-1',
      text: `Tell me about a real situation where you applied ${requirement} while working in or alongside a Construction Project Manager role. What was your specific responsibility and what was the outcome?`,
      difficulty: 'HARD' as const,
      topicCategories: ['construction management'],
      aiEvaluationGuidance: guidance,
    }];

    const [question] = getEffectiveQuestions({ jobRole: { title: 'Construction Project Manager', questions: authored } });

    expect(question.text.split(/\s+/)).toHaveLength(22);
    expect(question.text).toBe('Tell me about a time you had to manage hotel construction and renovation projects from initiation to completion. What was the outcome?');
    expect(question.aiEvaluationGuidance).toBe(guidance);
  });
});
