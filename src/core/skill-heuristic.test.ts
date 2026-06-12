/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it } from 'vitest';
import { heuristicTriageSkills, SkillClusterSummary } from './skill-heuristic';

function cluster(over: Partial<SkillClusterSummary>): SkillClusterSummary {
  return {
    id: over.id ?? 'c1',
    label: over.label ?? 'parse log files',
    occurrences: over.occurrences ?? 5,
    sessions: over.sessions ?? 3,
    cancelRate: over.cancelRate ?? 0,
    avgCorrectionTurns: over.avgCorrectionTurns ?? 0,
  };
}

describe('heuristicTriageSkills', () => {
  it('drops clusters below the repetition thresholds', () => {
    const result = heuristicTriageSkills([
      cluster({ id: 'rare', occurrences: 2, sessions: 3 }),
      cluster({ id: 'one-session', occurrences: 9, sessions: 1 }),
      cluster({ id: 'keep', occurrences: 4, sessions: 2 }),
    ]);
    expect(result.map(r => r.id)).toEqual(['keep']);
  });

  it('marks every survivor as a strong opportunity', () => {
    const result = heuristicTriageSkills([cluster({})]);
    expect(result).toHaveLength(1);
    expect(result[0].verdict).toBe('strong');
  });

  it('ranks higher-signal clusters first and caps at 10', () => {
    const many = Array.from({ length: 15 }, (_, i) =>
      cluster({ id: `c${i}`, label: `task ${i}`, occurrences: i + 3, sessions: 2 }),
    );
    const result = heuristicTriageSkills(many);
    expect(result).toHaveLength(10);
    // Highest occurrences (c14) should rank first.
    expect(result[0].id).toBe('c14');
  });

  it('mentions cancel rate when prompts are frequently cancelled', () => {
    const [r] = heuristicTriageSkills([cluster({ cancelRate: 0.4 })]);
    expect(r.reason).toContain('40% cancel rate');
  });

  it('mentions correction turns when there is no high cancel rate', () => {
    const [r] = heuristicTriageSkills([cluster({ cancelRate: 0, avgCorrectionTurns: 3 })]);
    expect(r.reason).toContain('3 correction turns');
  });

  it('derives a kebab-case skill name capped at four words', () => {
    const [r] = heuristicTriageSkills([
      cluster({ label: 'Scaffold a new React component quickly' }),
    ]);
    expect(r.suggestedSkillName).toBe('scaffold-a-new-react');
  });

  it('returns a null skill name when the label has no usable characters', () => {
    const [r] = heuristicTriageSkills([cluster({ label: '***' })]);
    expect(r.suggestedSkillName).toBeNull();
  });
});
