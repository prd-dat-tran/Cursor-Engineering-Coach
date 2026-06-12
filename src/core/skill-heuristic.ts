/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * LLM-free ranking of skill candidates from workflow clusters.
 *
 * This exists because Cursor does not expose its AI models through the VS Code
 * Language Model API (`vscode.lm.selectChatModels` returns an empty array), so the
 * panel's AI skill triage can't run there. When no model is available we rank
 * locally: a cluster is a strong candidate when the same kind of prompt recurs
 * across multiple sessions, and friction (cancels / correction turns) raises its
 * priority because that's where a captured skill helps most.
 *
 * Pure and dependency-free so it can be unit-tested and reused anywhere.
 */

export interface SkillClusterSummary {
  id: string;
  label: string;
  occurrences: number;
  sessions: number;
  cancelRate: number;
  avgCorrectionTurns: number;
}

export interface SkillTriageItem {
  id: string;
  label: string;
  verdict: 'strong' | 'maybe' | 'skip';
  reason: string;
  suggestedSkillName: string | null;
}

/** A cluster must recur this often, across this many sessions, to be a candidate. */
const MIN_OCCURRENCES = 3;
const MIN_SESSIONS = 2;
const MAX_RESULTS = 10;

function slugName(label: string): string {
  return label.toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, '-')
    .replaceAll(/-+/g, '-')
    .replaceAll(/^-|-$/g, '')
    .split('-')
    .filter(Boolean)
    .slice(0, 4)
    .join('-');
}

function frictionNote(c: SkillClusterSummary): string {
  if (c.cancelRate >= 0.2) return ` with a ${Math.round(c.cancelRate * 100)}% cancel rate`;
  if (c.avgCorrectionTurns >= 2) return ` averaging ${c.avgCorrectionTurns.toFixed(0)} correction turns`;
  return '';
}

/** Rank workflow clusters into "strong" skill opportunities without an LLM. */
export function heuristicTriageSkills(clusters: SkillClusterSummary[]): SkillTriageItem[] {
  return clusters
    .filter(c => c.occurrences >= MIN_OCCURRENCES && c.sessions >= MIN_SESSIONS)
    .map(c => {
      const friction = c.cancelRate * c.occurrences * 0.5 + c.avgCorrectionTurns * c.sessions * 0.3;
      return { c, score: c.occurrences + c.sessions * 0.5 + friction };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_RESULTS)
    .map(({ c }) => {
      const name = slugName(c.label);
      return {
        id: c.id,
        label: c.label,
        verdict: 'strong' as const,
        reason: `Seen ${c.occurrences}\u00d7 across ${c.sessions} sessions${frictionNote(c)} \u2014 a repeatable workflow worth capturing as a skill.`,
        suggestedSkillName: name || null,
      };
    });
}
