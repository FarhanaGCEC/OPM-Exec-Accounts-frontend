import { useState } from 'react';
import { ChevronDown, Code2 } from 'lucide-react';
import type { ChangeRequestRow } from '../services/changeRequestService';
import {
  payloadSummaryHeadline,
  summarizeChangeRequestPayload,
} from '../lib/changeRequestPayloadSummary';
import { changeRequestResourceLabel } from '../lib/changeRequestUi';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from './ui/popover';
import { Button } from './ui/button';

type Props = {
  row: Pick<ChangeRequestRow, 'action' | 'resourceType' | 'payload'>;
  compact?: boolean;
};

export function ChangeRequestPayloadSummary({ row, compact = false }: Props) {
  const [showRaw, setShowRaw] = useState(false);
  const lines = summarizeChangeRequestPayload(row);
  const headline = payloadSummaryHeadline(row);
  const actionLabel = row.action.charAt(0).toUpperCase() + row.action.slice(1).toLowerCase();
  const resourceLabel = changeRequestResourceLabel(row.resourceType);

  if (lines.length === 0) {
    return <span className="text-sm text-gray-400">—</span>;
  }

  const summaryList = (
    <ul className="space-y-1.5 text-sm text-gray-800">
      {lines.map((line) => (
        <li key={`${line.label}-${line.value}`} className="leading-snug">
          <span className="font-medium text-gray-900">{line.label}:</span>{' '}
          <span className="text-gray-700">{line.value}</span>
        </li>
      ))}
    </ul>
  );

  if (!compact && lines.length <= 3) {
    return (
      <div className="min-w-[200px] max-w-[320px]">
        <p className="text-xs font-semibold uppercase tracking-wide text-amber-900/80 mb-1">
          {actionLabel} · {resourceLabel}
        </p>
        {summaryList}
      </div>
    );
  }

  const rawJson =
    row.payload && typeof row.payload === 'object'
      ? JSON.stringify(row.payload, null, 2)
      : '';

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="text-left w-full max-w-[280px] rounded-md border border-amber-200/80 bg-amber-50/60 px-2.5 py-2 hover:bg-amber-50 transition-colors"
        >
          <p className="text-xs font-semibold text-amber-900">{headline}</p>
          <ul className="mt-1 space-y-0.5">
            {lines.slice(0, compact ? 2 : 3).map((line) => (
              <li key={`${line.label}-${line.value}`} className="text-xs text-gray-700 truncate">
                <span className="font-medium">{line.label}:</span> {line.value}
              </li>
            ))}
          </ul>
          {lines.length > (compact ? 2 : 3) && (
            <p className="text-xs text-amber-800 mt-1 flex items-center gap-0.5">
              View all {lines.length} changes
              <ChevronDown className="w-3 h-3" />
            </p>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-[min(100vw-2rem,380px)] p-0 border border-gray-200 shadow-lg"
      >
        <div className="bg-[#f7c46d] px-3 py-2 border-b border-gray-200">
          <p className="text-sm font-bold text-black">Requested changes</p>
          <p className="text-xs text-gray-800">
            {actionLabel} · {resourceLabel}
          </p>
        </div>
        <div className="p-3 max-h-[280px] overflow-y-auto">{summaryList}</div>
        {rawJson && (
          <div className="border-t border-gray-100 px-3 py-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs text-gray-600"
              onClick={() => setShowRaw((v) => !v)}
            >
              <Code2 className="w-3 h-3 mr-1" />
              {showRaw ? 'Hide technical JSON' : 'Show technical JSON'}
            </Button>
            {showRaw && (
              <pre className="mt-2 text-[10px] leading-tight font-mono text-gray-600 bg-gray-50 rounded p-2 overflow-x-auto max-h-32">
                {rawJson}
              </pre>
            )}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
