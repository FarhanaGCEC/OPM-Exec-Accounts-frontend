import { useCallback, useEffect, useState } from 'react';
import Layout from '../components/Layout';
import { Button } from '../components/ui/button';
import { Card, CardContent } from '../components/ui/card';
import { ClipboardList, Loader2, RefreshCw } from 'lucide-react';
import {
  changeRequestService,
  type ChangeRequestRow,
} from '../services/changeRequestService';
import { formatIsoDateTimeDisplay } from '../lib/formatDisplayDate';
import {
  changeRequestResourceLabel,
  userChangeRequestStatusHint,
} from '../lib/changeRequestUi';

function statusClass(status: string): string {
  const s = status.toLowerCase();
  if (s === 'pending') return 'bg-amber-100 text-amber-900';
  if (s === 'approved') return 'bg-emerald-100 text-emerald-900';
  if (s === 'rejected') return 'bg-red-100 text-red-900';
  return 'bg-gray-100 text-gray-800';
}

export default function MyChangeRequests() {
  const [rows, setRows] = useState<ChangeRequestRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    setLoading(true);
    try {
      const list = await changeRequestService.myRequests();
      setRows(list);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load requests');
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <Layout>
      <div className="mb-6 flex flex-col gap-4 border-b border-gray-200 shadow-md pb-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3 ml-16">
          <ClipboardList className="w-8 h-8 text-gray-900 shrink-0 mt-0.5" />
          <div>
            <h2 className="text-2xl font-bold text-gray-900">My change requests</h2>
            <p className="text-sm text-gray-600 mt-0.5">
              Edits and deletes you submitted for admin approval.
            </p>
          </div>
        </div>
        <Button
          type="button"
          variant="outline"
          onClick={() => void load()}
          disabled={loading}
          className="bg-white hover:bg-[#f7c46d] text-black border-gray-300 flex items-center gap-2 mr-4 shrink-0"
        >
          {loading ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <RefreshCw className="w-4 h-4" />
          )}
          Refresh
        </Button>
      </div>

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
                      Action
                    </th>
                    <th className="font-semibold text-black text-sm text-left py-2 px-4 align-middle">
                      Resource
                    </th>
                    <th className="font-semibold text-black text-sm text-left py-2 px-4 align-middle">
                      Status
                    </th>
                    <th className="font-semibold text-black text-sm text-left py-2 px-4 align-middle">
                      Update
                    </th>
                    <th className="font-semibold text-black text-sm text-left py-2 px-4 align-middle">
                      Your note
                    </th>
                    <th className="font-semibold text-black text-sm text-left py-2 px-4 align-middle">
                      Admin review
                    </th>
                    <th className="font-semibold text-black text-sm text-left py-2 px-4 align-middle">
                      Created
                    </th>
                  </tr>
                </thead>
                <tbody className="[&_tr:last-child]:border-0">
                  {loading ? (
                    <tr>
                      <td colSpan={8} className="text-center py-4 px-4 align-middle">
                        <Loader2 className="w-6 h-6 animate-spin mx-auto mb-2 text-gray-400" />
                        <p className="text-sm text-gray-500">Loading requests...</p>
                      </td>
                    </tr>
                  ) : rows.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="text-center py-4 px-4 align-middle">
                        <p className="text-sm text-gray-500 mb-1">No requests yet.</p>
                        <p className="text-sm text-gray-400">
                          Submit changes from screens where your role requires approval.
                        </p>
                      </td>
                    </tr>
                  ) : (
                    rows.map((r) => (
                      <tr
                        key={String(r.id)}
                        className="border-b border-gray-100 hover:bg-gray-50 transition-colors"
                      >
                        <td className="px-4 py-2 align-middle text-sm font-mono text-gray-800">
                          {String(r.id)}
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
                        </td>
                        <td className="px-4 py-2 align-middle text-sm">
                          <span
                            className={`inline-flex px-2 py-0.5 rounded-md text-xs font-medium ${statusClass(r.status)}`}
                          >
                            {r.status}
                          </span>
                        </td>
                        <td className="px-4 py-2 align-middle text-sm text-gray-700 max-w-[220px]">
                          {userChangeRequestStatusHint(r)}
                        </td>
                        <td
                          className="px-4 py-2 align-middle text-sm text-gray-700 max-w-xs truncate"
                          title={r.note ?? ''}
                        >
                          {r.note || '—'}
                        </td>
                        <td
                          className="px-4 py-2 align-middle text-sm text-gray-700 max-w-xs truncate"
                          title={r.reviewNote ?? ''}
                        >
                          {r.reviewNote || '—'}
                        </td>
                        <td className="px-4 py-2 align-middle text-sm text-gray-700 whitespace-nowrap">
                          {formatIsoDateTimeDisplay(r.createdAt)}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </CardContent>
      </Card>
    </Layout>
  );
}
