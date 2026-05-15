import api from '../lib/api';
import type { ApiResponse } from '../lib/api';
import { parseApproveChangeRequestData } from '../lib/changeRequestUi';

export type ChangeRequestAction = 'edit' | 'delete';

export interface CreateChangeRequestBody {
  action: ChangeRequestAction;
  resourceType: string;
  resourceId: string;
  payload?: Record<string, unknown>;
  /** Optional user message (e.g. delete reason) — sent as `note`. */
  note?: string;
}

export interface ChangeRequestRow {
  id: number | string;
  action: string;
  resourceType: string;
  resourceId?: string;
  payload?: Record<string, unknown> | null;
  status: string;
  reviewNote?: string | null;
  /** Submitter's optional note (`requestNote` from API, or legacy `note`). */
  note?: string | null;
  createdAt?: string;
  updatedAt?: string;
  requesterId?: number | string;
  requesterUsername?: string;
}

function mapRow(raw: Record<string, unknown>): ChangeRequestRow {
  const rid = raw.resourceId ?? raw.resource_id;
  return {
    id: (raw.id as number | string) ?? '',
    action: String(raw.action ?? ''),
    resourceType: String(raw.resourceType ?? raw.resource_type ?? ''),
    resourceId: rid != null && rid !== '' ? String(rid) : undefined,
    payload: (raw.payload as Record<string, unknown> | null | undefined) ?? null,
    status: String(raw.status ?? ''),
    reviewNote: (raw.reviewNote ?? raw.review_note) as string | null | undefined,
    note: (raw.requestNote ??
      raw.request_note ??
      raw.note ??
      raw.user_note ??
      raw.userNote) as string | null | undefined,
    createdAt: (raw.createdAt ?? raw.created_at) as string | undefined,
    updatedAt: (raw.updatedAt ?? raw.updated_at) as string | undefined,
    requesterId: (raw.requesterId ?? raw.requester_id ?? raw.userId ?? raw.user_id) as number | string | undefined,
    requesterUsername: (raw.requesterUsername ??
      raw.requester_username ??
      raw.username) as string | undefined,
  };
}

function extractRows(payload: unknown): ChangeRequestRow[] {
  if (Array.isArray(payload)) {
    return (payload as Record<string, unknown>[]).map((row) => mapRow(row));
  }
  if (!payload || typeof payload !== 'object') return [];
  const o = payload as Record<string, unknown>;
  if (Array.isArray(o.requests)) {
    return (o.requests as Record<string, unknown>[]).map((row) => mapRow(row));
  }
  if (Array.isArray(o.changeRequests)) {
    return (o.changeRequests as Record<string, unknown>[]).map((row) => mapRow(row));
  }
  if (Array.isArray(o.data)) {
    return (o.data as Record<string, unknown>[]).map((row) => mapRow(row));
  }
  const inner = o.data;
  if (inner && typeof inner === 'object' && Array.isArray((inner as Record<string, unknown>).requests)) {
    return ((inner as { requests: Record<string, unknown>[] }).requests).map((row) => mapRow(row));
  }
  if (
    inner &&
    typeof inner === 'object' &&
    Array.isArray((inner as Record<string, unknown>).changeRequests)
  ) {
    return ((inner as { changeRequests: Record<string, unknown>[] }).changeRequests).map((row) =>
      mapRow(row)
    );
  }
  return [];
}

function readPendingCount(obj: Record<string, unknown> | null | undefined): number | null {
  if (!obj) return null;
  const pc = obj.pendingCount ?? obj.pending_count;
  return typeof pc === 'number' ? pc : null;
}

function parsePendingCountFromResponse(res: ApiResponse<unknown>): number {
  if (!res.success || res.data === undefined || res.data === null) return 0;
  const top = res.data as Record<string, unknown>;
  let c = readPendingCount(top);
  if (c != null) return c;
  if (top.data && typeof top.data === 'object' && !Array.isArray(top.data)) {
    c = readPendingCount(top.data as Record<string, unknown>);
    if (c != null) return c;
  }
  return 0;
}

function rowsFromResponse(res: ApiResponse<unknown>): ChangeRequestRow[] {
  if (!res.success || res.data === undefined || res.data === null) return [];
  const raw = res.data as Record<string, unknown>;
  const fromNestedData =
    raw.data !== undefined && typeof raw.data === 'object' && !Array.isArray(raw.data)
      ? extractRows(raw.data)
      : [];
  if (fromNestedData.length > 0) return fromNestedData;
  return extractRows(res.data);
}

/**
 * Absolute URL for `EventSource` (same-origin `/api/...` in dev via Vite proxy).
 * Token is query-only because `EventSource` cannot set Authorization headers.
 */
function buildAdminStreamUrl(token: string): string {
  const base = (import.meta.env.VITE_API_BASE_URL || '/api').replace(/\/$/, '');
  const path = `${base}/admin/change-requests/stream`;
  if (base.startsWith('http://') || base.startsWith('https://')) {
    const u = new URL(path);
    u.searchParams.set('token', token);
    return u.toString();
  }
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const u = new URL(`${origin}${path.startsWith('/') ? path : `/${path}`}`);
  u.searchParams.set('token', token);
  return u.toString();
}

export const changeRequestService = {
  adminStreamUrl: buildAdminStreamUrl,

  submit: async (body: CreateChangeRequestBody): Promise<ApiResponse<unknown>> => {
    const req: Record<string, unknown> = {
      action: body.action,
      resourceType: body.resourceType,
      resourceId: body.resourceId,
    };
    if (body.payload !== undefined) {
      req.payload = body.payload;
    }
    if (body.note?.trim()) {
      req.note = body.note.trim();
    }
    return api.post<unknown>('/user/change-requests', req);
  },

  myRequests: async (): Promise<ChangeRequestRow[]> => {
    const res = await api.get<unknown>('/user/change-requests');
    return rowsFromResponse(res);
  },

  /** Admin — includes `pendingCount` from the list endpoint. */
  listAdminWithMeta: async (
    status?: string
  ): Promise<{ rows: ChangeRequestRow[]; pendingCount: number }> => {
    const q = status ? `?status=${encodeURIComponent(status)}` : '';
    const res = await api.get<unknown>(`/admin/change-requests${q}`);
    return {
      rows: rowsFromResponse(res),
      pendingCount: parsePendingCountFromResponse(res),
    };
  },

  listAdmin: async (status?: string): Promise<ChangeRequestRow[]> => {
    const { rows } = await changeRequestService.listAdminWithMeta(status);
    return rows;
  },

  approve: async (id: number | string): Promise<ApiResponse<unknown>> => {
    return api.post<unknown>(`/admin/change-requests/${id}/approve`, {});
  },

  parseApproveBody: parseApproveChangeRequestData,

  reject: async (id: number | string, reviewNote?: string): Promise<ApiResponse<unknown>> => {
    return api.post<unknown>(`/admin/change-requests/${id}/reject`, {
      ...(reviewNote?.trim() ? { reviewNote: reviewNote.trim() } : {}),
    });
  },
};
