import type { ApiResponse } from './api';
import { extractSuccessMessageFromBody, isQueuedForAdminApproval } from './api';
import type { ChangeRequestRow } from '../services/changeRequestService';

/**
 * Server returned HTTP 2xx with a body meaning the mutation was queued for admin approval,
 * not applied immediately (e.g. DELETE purchase bill → `code: "CHANGE_REQUEST_SUBMITTED"`).
 * Callers must not remove the row from local state in this case.
 */
export function isChangeRequestSubmittedEnvelope(body: unknown): boolean {
  return isQueuedForAdminApproval(-1, body);
}

/** Standard-user DELETE/PUT/PATCH: queued for approval (202 or envelope). */
export function isChangeRequestQueuedResponse(res: ApiResponse<unknown>): boolean {
  if (res.changeRequestQueued) return true;
  if (res.status === 202) return true;
  return isChangeRequestSubmittedEnvelope(res.data);
}

/** Admin/accountant immediate success — safe to remove row from list. */
export function isImmediateMutationSuccess(res: ApiResponse<unknown>): boolean {
  return res.success === true && !isChangeRequestQueuedResponse(res);
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

/** Admin approve/reject — message from API (`Approved and applied`, errors, etc.). */
export function userMessageFromChangeRequestReview(
  res: ApiResponse<unknown>,
  fallback: string
): string {
  return userMessageFromChangeRequestSubmit(res, fallback);
}

export type ApproveChangeRequestData = {
  message?: string;
  request?: ChangeRequestRow;
  closedDuplicateRequestIds?: number[];
};

export function parseApproveChangeRequestData(data: unknown): ApproveChangeRequestData {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return {};
  const o = data as Record<string, unknown>;
  const closed = o.closedDuplicateRequestIds ?? o.closed_duplicate_request_ids;
  const ids = Array.isArray(closed)
    ? closed
        .map((x) => (typeof x === 'number' ? x : parseInt(String(x), 10)))
        .filter((n) => Number.isInteger(n) && n > 0)
    : [];
  return {
    message: typeof o.message === 'string' ? o.message : undefined,
    request: (o.request as ChangeRequestRow | undefined) ?? undefined,
    closedDuplicateRequestIds: ids,
  };
}

export function parseClosedDuplicateRequestIds(data: unknown): number[] {
  return parseApproveChangeRequestData(data).closedDuplicateRequestIds ?? [];
}

export function isChangeRequestConflictError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const o = err as Record<string, unknown>;
  return o.status === 409;
}

export function changeRequestResourceLabel(resourceType: string): string {
  const t = resourceType.toLowerCase().replace(/-/g, '_');
  const labels: Record<string, string> = {
    transaction: 'Transaction',
    credit_card_payment: 'Credit card payment',
    purchase_bill: 'Purchase bill',
    post_dated_cheque: 'Post-dated cheque',
    pdc: 'Post-dated cheque',
    card_statement: 'Card statement',
    payables_category: 'Payables category',
    receivables_category: 'Receivables category',
    user_self: 'User profile',
  };
  return labels[t] ?? resourceType;
}

export function changeRequestResourceKey(r: Pick<ChangeRequestRow, 'resourceType' | 'resourceId' | 'action'>): string {
  return `${r.resourceType}:${r.resourceId ?? ''}:${r.action}`;
}

/** Group pending rows that target the same resource + action (duplicates). */
export function groupPendingChangeRequests(rows: ChangeRequestRow[]): Map<string, ChangeRequestRow[]> {
  const map = new Map<string, ChangeRequestRow[]>();
  for (const r of rows) {
    if (r.status.toLowerCase() !== 'pending') continue;
    const key = changeRequestResourceKey(r);
    const list = map.get(key) ?? [];
    list.push(r);
    map.set(key, list);
  }
  for (const list of map.values()) {
    list.sort((a, b) => {
      const ta = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const tb = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      return tb - ta;
    });
  }
  return map;
}

export function isLatestPendingInResourceGroup(
  row: ChangeRequestRow,
  groups: Map<string, ChangeRequestRow[]>
): boolean {
  const list = groups.get(changeRequestResourceKey(row));
  if (!list || list.length <= 1) return true;
  return String(list[0].id) === String(row.id);
}

export function duplicatePendingHint(
  row: ChangeRequestRow,
  groups: Map<string, ChangeRequestRow[]>
): string | null {
  const list = groups.get(changeRequestResourceKey(row));
  if (!list || list.length <= 1) return null;
  const label = changeRequestResourceLabel(row.resourceType);
  return `${label} #${row.resourceId} — ${list.length} pending requests (approve latest #${list[0].id})`;
}

export function userChangeRequestStatusHint(row: ChangeRequestRow): string {
  const s = row.status.toLowerCase();
  if (s === 'pending') {
    return 'Waiting for admin approval — record is unchanged until approved.';
  }
  if (s === 'approved') {
    return 'Admin approved — your change has been applied.';
  }
  if (s === 'rejected') {
    if (row.reviewNote?.trim()) {
      return `Admin rejected: ${row.reviewNote.trim()}`;
    }
    return 'Admin rejected this request. You can submit a new request if needed.';
  }
  return row.status;
}

export function mutationErrorMessage(err: unknown): string {
  if (!err || typeof err !== 'object') return 'Request failed';
  const o = err as Record<string, unknown>;
  const msg = typeof o.message === 'string' ? o.message : 'Request failed';
  if (o.code === 'APPROVAL_REQUIRED' || (o.status === 403 && msg.toLowerCase().includes('approval'))) {
    return 'Direct edit/delete is not allowed for your role. Submit a change request instead.';
  }
  if (o.status === 403 && (msg.toLowerCase().includes('own') || msg.toLowerCase().includes('created'))) {
    return 'You can only request changes for entries you created.';
  }
  if (o.status === 409) {
    return msg || 'This request was already approved or rejected. Refresh the list.';
  }
  return msg;
}
