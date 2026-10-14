import { useCallback, useEffect, useMemo, useState } from 'react';
import Layout from '../components/Layout';
import { Button } from '../components/ui/button';
import { Card, CardContent } from '../components/ui/card';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../components/ui/select';
import { Inbox, Loader2, RefreshCw, Check, X } from 'lucide-react';
import {
  changeRequestService,
  type ChangeRequestRow,
} from '../services/changeRequestService';
import { useAdminChangeRequestStream } from '../context/AdminChangeRequestStreamContext';
import { formatIsoDateTimeDisplay } from '../lib/formatDisplayDate';
import type { ApiResponse } from '../lib/api';
import { ChangeRequestPayloadSummary } from '../components/ChangeRequestPayloadSummary';
import {
  changeRequestResourceLabel,
  duplicatePendingHint,
  groupPendingChangeRequests,
  isChangeRequestConflictError,
  isLatestPendingInResourceGroup,
  parseClosedDuplicateRequestIds,
  userMessageFromChangeRequestReview,
} from '../lib/changeRequestUi';

function statusClass(status: string): string {
  const s = status.toLowerCase();
  if (s === 'pending') return 'bg-amber-100 text-amber-900';
  if (s === 'approved') return 'bg-emerald-100 text-emerald-900';
  if (s === 'rejected') return 'bg-red-100 text-red-900';
  return 'bg-gray-100 text-gray-800';
}

export default function ApprovalQueue() {
  const { pendingCount: livePendingCount, streamConnected, streamRefreshKey } =
    useAdminChangeRequestStream();
  const [filter, setFilter] = useState<'pending' | 'all'>('pending');
  const [rows, setRows] = useState<ChangeRequestRow[]>([]);
  const [listPendingCount, setListPendingCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [infoMessage, setInfoMessage] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rejectRow, setRejectRow] = useState<ChangeRequestRow | null>(null);
  const [rejectNote, setRejectNote] = useState('');
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  const pendingGroups = useMemo(() => groupPendingChangeRequests(rows), [rows]);

  const load = useCallback(async () => {
    setError(null);
    setLoading(true);
    try {
      const { rows: list, pendingCount } = await changeRequestService.listAdminWithMeta(
        filter === 'pending' ? 'pending' : undefined
      );
      setRows(list);
      setListPendingCount(pendingCount);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load queue');
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => {
    void load();
  }, [load, streamRefreshKey]);

  const handleApprove = async (r: ChangeRequestRow) => {
    setBusyId(String(r.id));
    setActionMessage(null);
    setInfoMessage(null);
    setError(null);
    try {
      const res = await changeRequestService.approve(r.id);
      const parsed = changeRequestService.parseApproveBody(res.data);
      const closedIds = parsed.closedDuplicateRequestIds?.length
        ? parsed.closedDuplicateRequestIds
        : parseClosedDuplicateRequestIds(res.data);

      let msg = userMessageFromChangeRequestReview(
        res as ApiResponse<unknown>,
        `Request ${r.id} approved and applied.`
      );
      if (closedIds.length > 0) {
        msg += ` ${closedIds.length} duplicate request(s) auto-closed.`;
      }
      setActionMessage(msg);
      await load();
    } catch (e: unknown) {
      if (isChangeRequestConflictError(e)) {
        setInfoMessage(
          e instanceof Error
            ? e.message
            : 'This request was already approved or rejected. Refreshing list.'
        );
        await load();
        return;
      }
      setError(e instanceof Error ? e.message : 'Approve failed');
    } finally {
      setBusyId(null);
    }
  };

  const openReject = (r: ChangeRequestRow) => {
    setRejectNote('');
    setRejectRow(r);
  };

  const confirmReject = async () => {
    if (!rejectRow) return;
    setBusyId(String(rejectRow.id));
    setError(null);
    setInfoMessage(null);
    try {
      const res = await changeRequestService.reject(rejectRow.id, rejectNote || undefined);
      const msg = userMessageFromChangeRequestReview(
        res as ApiResponse<unknown>,
        `Request ${rejectRow.id} rejected.`
      );
      setActionMessage(msg);
      setRejectRow(null);
      await load();
    } catch (e: unknown) {
      if (isChangeRequestConflictError(e)) {
        setInfoMessage(
          e instanceof Error
            ? e.message
            : 'This request was already approved or rejected. Refreshing list.'
        );
        setRejectRow(null);
        await load();
        return;
      }
      setError(e instanceof Error ? e.message : 'Reject failed');
    } finally {
      setBusyId(null);
    }
  };

  const displayPendingCount = Math.max(livePendingCount, listPendingCount);

  return (
    <Layout>
      <div className="mb-6 flex flex-col gap-4 border-b border-gray-200 shadow-md pb-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3 ml-16">
          <Inbox className="w-8 h-8 text-gray-900 shrink-0 mt-0.5" />
          <div>
            <h2 className="text-2xl font-bold text-gray-900">Approval queue</h2>
            <p className="text-sm text-gray-600 mt-0.5">
              Review change requests from standard users; approving applies them on the server.
              {displayPendingCount > 0 && (
                <span className="ml-2 inline-flex items-center rounded-md bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-900">
                  {displayPendingCount} pending
                </span>
              )}
              {streamConnected && (
                <span
                  className="ml-2 text-xs font-medium text-emerald-700"
                  title="Listening for new requests"
                >
                  ● Live
                </span>
              )}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 mr-4 shrink-0">
          <Select value={filter} onValueChange={(v) => setFilter(v as 'pending' | 'all')}>
            <SelectTrigger className="w-[168px] bg-white border-gray-300 text-black">
              <SelectValue placeholder="Filter" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="pending">Pending only</SelectItem>
              <SelectItem value="all">All statuses</SelectItem>
            </SelectContent>
          </Select>
          <Button
            type="button"
            variant="outline"
            onClick={() => void load()}
            disabled={loading}
            className="bg-white hover:bg-[#f7c46d] text-black border-gray-300 flex items-center gap-2"
          >
            {loading ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <RefreshCw className="w-4 h-4" />
            )}
            Refresh
          </Button>
        </div>
      </div>

      {actionMessage && (
        <div className="mx-4 mb-2 p-3 bg-emerald-50 border border-emerald-200 rounded-md">
          <p className="text-sm text-emerald-800">{actionMessage}</p>
        </div>
      )}

      {infoMessage && (
        <div className="mx-4 mb-2 p-3 bg-blue-50 border border-blue-200 rounded-md">
          <p className="text-sm text-blue-800">{infoMessage}</p>
        </div>
      )}

      {error && (
        <div className="mx-4 mb-2 p-3 bg-red-50 border border-red-200 rounded-md">
          <p className="text-sm text-red-600">{error}</p>
        </div>
      )}

      <Card className="bg-white border border-gray-200 m-4">
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <div className="max-h-[600px] overflow-y-auto relative">
              <table className="w-full caption-bottom text-base border rounded-lg">
                <thead className="sticky top-0 z-20 bg-[#f7c46d] shadow-sm">
                  <tr className="bg-[#f7c46d] border-0">
                    <th className="font-semibold text-black text-sm text-left py-2 px-4 align-middle">
                      ID
                    </th>
                    <th className="font-semibold text-black text-sm text-left py-2 px-4 align-middle">
                      User
                    </th>
                    <th className="font-semibold text-black text-sm text-left py-2 px-4 align-middle">
                      Action
                    </th>
                    <th className="font-semibold text-black text-sm text-left py-2 px-4 align-middle">
                      Resource
                    </th>
                    <th className="font-semibold text-black text-sm text-left py-2 px-4 align-middle">
                      Status
                    </th>
                    <th className="font-semibold text-black text-sm text-left py-2 px-4 align-middle min-w-[220px]">
                      Requested changes
                    </th>
                    <th className="font-semibold text-black text-sm text-left py-2 px-4 align-middle">
                      User note
                    </th>
                    <th className="font-semibold text-black text-sm text-left py-2 px-4 align-middle">
                      Created
                    </th>
                    <th className="font-semibold text-black text-sm text-left py-2 px-4 align-middle w-[140px]">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="[&_tr:last-child]:border-0">
                  {loading ? (
                    <tr>
                      <td colSpan={9} className="text-center py-4 px-4 align-middle">
                        <Loader2 className="w-6 h-6 animate-spin mx-auto mb-2 text-gray-400" />
                        <p className="text-sm text-gray-500">Loading requests...</p>
                      </td>
                    </tr>
                  ) : rows.length === 0 ? (
                    <tr>
                      <td colSpan={9} className="text-center py-4 px-4 align-middle">
                        <p className="text-sm text-gray-500">No requests in this view.</p>
                      </td>
                    </tr>
                  ) : (
                    rows.map((r) => {
                      const pending = r.status.toLowerCase() === 'pending';
                      const dupHint = pending ? duplicatePendingHint(r, pendingGroups) : null;
                      const isLatest = isLatestPendingInResourceGroup(r, pendingGroups);
                      const showApprove = pending && isLatest;

                      return (
                        <tr
                          key={String(r.id)}
                          className={`border-b border-gray-100 hover:bg-gray-50 transition-colors ${
                            pending && !isLatest ? 'opacity-60' : ''
                          }`}
                        >
                          <td className="px-4 py-2 align-middle text-sm font-mono text-gray-800">
                            {String(r.id)}
                          </td>
                          <td className="px-4 py-2 align-middle text-sm text-gray-800">
                            {r.requesterUsername ??
                              (r.requesterId != null ? `#${r.requesterId}` : '—')}
                          </td>
                          <td className="px-4 py-2 align-middle text-sm capitalize text-gray-800">
                            {r.action}
                          </td>
                          <td className="px-4 py-2 align-middle text-sm text-gray-800">
                            <span className="font-medium text-gray-900">
                              {changeRequestResourceLabel(r.resourceType)}
                            </span>
                            {r.resourceId != null && r.resourceId !== '' && (
                              <span className="text-gray-600"> #{r.resourceId}</span>
                            )}
                            {dupHint && (
                              <p className="text-xs text-amber-800 mt-0.5" title={dupHint}>
                                {dupHint}
                              </p>
                            )}
                          </td>
                          <td className="px-4 py-2 align-middle text-sm">
                            <span
                              className={`inline-flex px-2 py-0.5 rounded-md text-xs font-medium ${statusClass(r.status)}`}
                            >
                              {r.status}
                            </span>
                          </td>
                          <td className="px-4 py-2 align-middle text-sm min-w-[220px] max-w-[320px]">
                            <ChangeRequestPayloadSummary row={r} compact />
                          </td>
                          <td
                            className="px-4 py-2 align-middle text-sm text-gray-700 max-w-[140px] truncate"
                            title={r.note ?? ''}
                          >
                            {r.note || '—'}
                          </td>
                          <td className="px-4 py-2 align-middle text-sm text-gray-700 whitespace-nowrap">
                            {formatIsoDateTimeDisplay(r.createdAt)}
                          </td>
                          <td className="px-4 py-2 align-middle">
                            {pending ? (
                              showApprove ? (
                                <div className="flex flex-wrap gap-1.5">
                                  <Button
                                    type="button"
                                    size="sm"
                                    className="bg-[#f7c46d] hover:bg-[#c9a82f] text-black h-8 px-2 text-xs"
                                    disabled={busyId !== null}
                                    onClick={() => void handleApprove(r)}
                                  >
                                    {busyId === String(r.id) ? (
                                      <Loader2 className="w-3 h-3 animate-spin" />
                                    ) : (
                                      <Check className="w-3 h-3" />
                                    )}
                                    <span className="ml-1">Approve</span>
                                  </Button>
                                  <Button
                                    type="button"
                                    size="sm"
                                    variant="outline"
                                    className="h-8 px-2 text-xs border-red-200 text-red-700 hover:bg-red-50"
                                    disabled={busyId !== null}
                                    onClick={() => openReject(r)}
                                  >
                                    <X className="w-3 h-3" />
                                    <span className="ml-1">Reject</span>
                                  </Button>
                                </div>
                              ) : (
                                <span className="text-xs text-amber-700">Use latest request</span>
                              )
                            ) : (
                              <span className="text-sm text-gray-400">—</span>
                            )}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </CardContent>
      </Card>

      <Dialog open={!!rejectRow} onOpenChange={(open) => !open && setRejectRow(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-xl font-bold text-gray-900">
              Reject request {rejectRow ? rejectRow.id : ''}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="reject-note">Review note (optional)</Label>
            <Input
              id="reject-note"
              value={rejectNote}
              onChange={(e) => setRejectNote(e.target.value)}
              placeholder="Reason for rejection"
              className="focus-visible:ring-2 focus-visible:ring-[#f7c46d]"
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setRejectRow(null)}>
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={busyId !== null}
              onClick={() => void confirmReject()}
            >
              {busyId ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Reject request'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Layout>
  );
}
