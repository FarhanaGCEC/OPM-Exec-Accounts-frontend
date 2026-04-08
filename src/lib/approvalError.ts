import type { AxiosError } from 'axios';
import axios from 'axios';

/**
 * Standard users get 403 with `code: "APPROVAL_REQUIRED"` when calling protected mutating routes.
 */
export function isApprovalRequiredError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const o = err as Record<string, unknown>;
  /** Thrown by api client when HTTP 2xx body has `success: false` + this code (not always status 403). */
  if (o.code === 'APPROVAL_REQUIRED') return true;
  if (o.status === 403 && o.code === 'APPROVAL_REQUIRED') return true;
  if (!axios.isAxiosError(err)) return false;
  const ax = err as AxiosError<{ code?: string; message?: string }>;
  const status = ax.response?.status;
  const code = ax.response?.data && typeof ax.response.data === 'object' && ax.response.data
    ? (ax.response.data as { code?: string }).code
    : undefined;
  return status === 403 && code === 'APPROVAL_REQUIRED';
}
