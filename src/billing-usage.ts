/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Opt-in live billing usage. This is the ONLY place in the extension that makes
 * a network call for analytics, and it is gated behind the
 * `cursorEngineeringCoach.billing.fetchLiveUsage` setting (default off).
 *
 * Privacy contract (mirrors the project's "local-first" stance):
 *   - No request is made unless the user explicitly enables the setting.
 *   - The Cursor access token is read fresh from the local account DB on each
 *     call, used transiently as a Bearer credential, and never stored or logged.
 *   - The token is sent ONLY to Cursor's own backend over HTTPS.
 *   - Failures are swallowed and sanitized — never surface the token or paths.
 */

import * as vscode from 'vscode';
import { LiveUsage } from './core/billing';
import { readCursorAccessToken } from './core/parser-cursor';
import { BILLING_CONFIG_SECTION } from './billing-vscode';

// Cursor's backend usage endpoint (undocumented; accepts the local JWT as a
// Bearer token). Verified to return `{ "gpt-4": { numRequests, maxRequestUsage }, startOfMonth }`.
const USAGE_ENDPOINT = 'https://api2.cursor.sh/auth/usage';
const FETCH_TIMEOUT_MS = 12_000;
const CACHE_TTL_MS = 60_000;

let cache: { at: number; value: LiveUsage | null } | undefined;

/** True when the user opted in to live usage fetching. */
export function liveUsageEnabled(): boolean {
  return vscode.workspace.getConfiguration(BILLING_CONFIG_SECTION).get<boolean>('fetchLiveUsage') === true;
}

function parseUsage(data: unknown): LiveUsage {
  let requestsUsed = 0;
  let requestsLimit: number | null = null;
  let cycleStart: string | null = null;
  if (data && typeof data === 'object') {
    const obj = data as Record<string, unknown>;
    const premium = obj['gpt-4'];
    if (premium && typeof premium === 'object') {
      const p = premium as Record<string, unknown>;
      if (typeof p.numRequests === 'number') requestsUsed = p.numRequests;
      if (typeof p.maxRequestUsage === 'number') requestsLimit = p.maxRequestUsage;
    }
    if (typeof obj.startOfMonth === 'string') cycleStart = obj.startOfMonth;
  }
  return { requestsUsed, requestsLimit, cycleStart, fetchedAt: Date.now() };
}

/**
 * Fetch live usage when opted in. Returns null when disabled, when no token is
 * available, or on any error. Results are cached briefly to avoid hammering the
 * endpoint across the dashboard and chat.
 */
export async function fetchLiveUsage(force = false): Promise<LiveUsage | null> {
  if (!liveUsageEnabled()) return null;
  if (!force && cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.value;

  const token = readCursorAccessToken();
  if (!token) {
    cache = { at: Date.now(), value: null };
    return null;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const resp = await fetch(USAGE_ENDPOINT, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      signal: controller.signal,
    });
    if (!resp.ok) {
      cache = { at: Date.now(), value: null };
      return null;
    }
    const value = parseUsage(await resp.json());
    cache = { at: Date.now(), value };
    return value;
  } catch {
    // Sanitized on purpose: never include the token, URL credentials, or paths.
    cache = { at: Date.now(), value: null };
    return null;
  } finally {
    clearTimeout(timer);
  }
}
