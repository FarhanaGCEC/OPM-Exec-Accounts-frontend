import { Calendar as CalendarIcon, Filter, X } from 'lucide-react';
import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import Calendar from '@/components/ui/calendar-tailwind';
import {
  formatDisplayYear,
  parseCalendarDateLocal,
} from '@/lib/formatDisplayDate';

const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const;

function startOfLocalDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

export type FxAdcbActiveTab = 'all' | 'online' | 'cheque' | 'cash' | 'debit' | 'credit';

export interface FxAdcbFilterState {
  startDate: string;
  endDate: string;
  searchDetails: string;
  searchAmount: string;
  searchDescription: string;
}

interface FxAdcbTransactionFilterBarProps {
  filters: FxAdcbFilterState;
  activeTab: FxAdcbActiveTab;
  onFiltersChange: (next: FxAdcbFilterState) => void;
  onActiveTabChange: (tab: FxAdcbActiveTab) => void;
  onClearFilters: () => void;
  toolbarActions?: ReactNode;
}

function FilterDateInput({
  value,
  onChange,
  clampToToday = false,
}: {
  value: string;
  onChange: (value: string) => void;
  clampToToday?: boolean;
}) {
  const parsed = value ? parseCalendarDateLocal(value) : null;

  return (
    <div className="relative">
      <Input
        type="text"
        value={value}
        onChange={(e) => {
          let next = e.target.value
            .replace(/[^0-9.]/g, '')
            .replace(/(\..*)\./g, '$1');
          if (next.length >= 2) next = next.slice(0, 2) + '-' + next.slice(2);
          if (next.length >= 6) next = next.slice(0, 6) + '-' + next.slice(6, 10);
          onChange(next);
        }}
        maxLength={11}
        className="w-full pr-10 h-10"
      />
      <Popover>
        <PopoverTrigger asChild>
          <button
            type="button"
            className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
          >
            <CalendarIcon className="w-5 h-5" />
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start">
          <Calendar
            date={parsed}
            onSelect={(date) => {
              if (!date) return;
              const picked = clampToToday
                ? (() => {
                    const today = startOfLocalDay(new Date());
                    const d = startOfLocalDay(date);
                    return d.getTime() > today.getTime() ? today : d;
                  })()
                : date;
              const day = String(picked.getDate()).padStart(2, '0');
              const month = MONTHS[picked.getMonth()];
              const year = formatDisplayYear(picked.getFullYear());
              onChange(`${day}-${month}-${year}`);
            }}
          />
        </PopoverContent>
      </Popover>
    </div>
  );
}

const TAB_OPTIONS: { id: FxAdcbActiveTab; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'online', label: 'Online' },
  { id: 'cheque', label: 'Cheque' },
  { id: 'cash', label: 'Cash' },
  { id: 'credit', label: 'Credit' },
  { id: 'debit', label: 'Debit' },
];

export default function FxAdcbTransactionFilterBar({
  filters,
  activeTab,
  onFiltersChange,
  onActiveTabChange,
  onClearFilters,
  toolbarActions,
}: FxAdcbTransactionFilterBarProps) {
  const setFilter = <K extends keyof FxAdcbFilterState>(key: K, value: FxAdcbFilterState[K]) => {
    onFiltersChange({ ...filters, [key]: value });
  };

  return (
    <>
      <Card className="bg-white border border-gray-200 shadow-sm rounded-lg mt-4 m-4 overflow-hidden">
        <CardContent className="p-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3 xl:grid-cols-[repeat(5,minmax(0,1fr))_auto] xl:items-end">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Start Date</label>
              <FilterDateInput
                value={filters.startDate}
                onChange={(v) => setFilter('startDate', v)}
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">End Date</label>
              <FilterDateInput
                value={filters.endDate}
                onChange={(v) => setFilter('endDate', v)}
                clampToToday
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Details</label>
              <div className="relative">
                <Input
                  type="text"
                  value={filters.searchDetails}
                  onChange={(e) => setFilter('searchDetails', e.target.value)}
                  className="w-full pl-3 pr-10 h-10"
                />
                {filters.searchDetails && (
                  <button
                    type="button"
                    onClick={() => setFilter('searchDetails', '')}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                  >
                    <X className="w-4 h-4" />
                  </button>
                )}
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Amount</label>
              <div className="relative">
                <Input
                  type="text"
                  value={filters.searchAmount}
                  onChange={(e) => setFilter('searchAmount', e.target.value)}
                  className="w-full pl-3 pr-10 h-10"
                />
                {filters.searchAmount && (
                  <button
                    type="button"
                    onClick={() => setFilter('searchAmount', '')}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                  >
                    <X className="w-4 h-4" />
                  </button>
                )}
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Description</label>
              <div className="relative">
                <Input
                  type="text"
                  value={filters.searchDescription}
                  onChange={(e) => setFilter('searchDescription', e.target.value)}
                  className="w-full pl-3 pr-10 h-10"
                />
                {filters.searchDescription && (
                  <button
                    type="button"
                    onClick={() => setFilter('searchDescription', '')}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                  >
                    <X className="w-4 h-4" />
                  </button>
                )}
              </div>
            </div>

            <div className="flex shrink-0 items-center justify-end gap-2 sm:col-span-2 md:col-span-3 xl:col-span-1">
              <Button
                type="button"
                variant="outline"
                onClick={onClearFilters}
                className="h-10 shrink-0 border border-gray-300 bg-white text-black hover:bg-gray-50 px-3"
                title="Clear filters"
              >
                <X className="w-4 h-4" />
              </Button>
              <Button
                type="button"
                className="bg-[#a8061d] hover:bg-[#6b0210] text-black h-10 shrink-0 whitespace-nowrap px-4 shadow-md hover:shadow-lg transition-shadow flex items-center justify-center gap-2"
                title="Filters apply automatically"
              >
                <Filter className="w-4 h-4" />
                Apply Filter
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="mx-4 mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2">
        {TAB_OPTIONS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => onActiveTabChange(tab.id)}
            className={`px-4 py-2 rounded-lg text-lg font-semibold transition-colors ${
              activeTab === tab.id
                ? 'bg-[#a8061d] text-black'
                : 'bg-white text-black border border-gray-300 hover:bg-gray-50'
            }`}
          >
            {tab.label}
          </button>
        ))}
        </div>
        {toolbarActions ? (
          <div className="flex flex-wrap items-center justify-end gap-2">{toolbarActions}</div>
        ) : null}
      </div>
    </>
  );
}

export function startOfLocalDayForFilter(d: Date): Date {
  return startOfLocalDay(d);
}

export function parseFxFilterDate(dateString: string): Date | null {
  return parseCalendarDateLocal(dateString);
}
