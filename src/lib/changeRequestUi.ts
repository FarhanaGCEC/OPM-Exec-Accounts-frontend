import type { ApiResponse } from './api';
import { extractSuccessMessageFromBody } from './api';

/**
 * Server returned HTTP 2xx with a body meaning the mutation was queued for admin approval,
 * not applied immediately (e.g. DELETE purchase bill → `code: "CHANGE_REQUEST_SUBMITTED"`).
 * Callers must not remove the row from local state in this case.
 */
export function isChangeRequestSubmittedEnvelope(body: unknown): boolean {
  if (!body || typeof body !== 'object') return false;
  const walk = (node: unknown, depth: number): boolean => {
    if (depth > 8 || !node || typeof node !== 'object' || Array.isArray(node)) return false;
    const o = node as Record<string, unknown>;
    if (o.code === 'CHANGE_REQUEST_SUBMITTED') return true;
    const inner = o.data;
    if (inner != null && typeof inner === 'object') return walk(inner, depth + 1);
    return false;
  };
  return walk(body, 0);
}

/** Shown when POST /user/change-requests succeeds but the body has no message field. */
export const DEFAULT_CHANGE_REQUEST_SUBMIT_ACK =
  'Your change request was sent for admin approval. It will apply after an admin approves it. You can track it under My change requests in the sidebar.';

/**
 * User-facing string after POST /user/change-requests succeeds
 * (e.g. `code: CHANGE_REQUEST_SUBMITTED`, top-level `message`, or nested envelopes).
 */
export function userMessageFromChangeRequestSubmit(
  res: ApiResponse<unknown>,
  fallback: string = DEFAULT_CHANGE_REQUEST_SUBMIT_ACK
): string {
  if (typeof res.message === 'string' && res.message.trim()) return res.message.trim();
  const fromBody = extractSuccessMessageFromBody(res.data);
  if (fromBody) return fromBody;
  return fallback;
}
