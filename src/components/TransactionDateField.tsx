import { useEffect, useState } from 'react';
import { Calendar as CalendarIcon } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import Calendar from '@/components/ui/calendar-tailwind';
import {
  formatTransactionFormDate,
  parseTransactionFormDate,
} from '../lib/transactionFormDate';

export default function TransactionDateField({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const [selectedDate, setSelectedDate] = useState<Date | null>(() =>
    parseTransactionFormDate(value)
  );
  const [isPopoverOpen, setIsPopoverOpen] = useState(false);

  useEffect(() => {
    const parsed = parseTransactionFormDate(value);
    if (parsed) {
      const currentTime = selectedDate?.getTime();
      const parsedTime = parsed.getTime();
      if (!currentTime || currentTime !== parsedTime) {
        setSelectedDate(parsed);
      }
    } else if (value === '' && selectedDate !== null) {
      setSelectedDate(null);
    }
  }, [value, selectedDate]);

  const handleDateSelect = (date: Date | null) => {
    if (date && !isNaN(date.getTime())) {
      setSelectedDate(date);
      onChange(formatTransactionFormDate(date));
      setIsPopoverOpen(false);
    }
  };

  return (
    <Popover modal={false} open={isPopoverOpen} onOpenChange={setIsPopoverOpen}>
      <div className="relative">
        <Input
          placeholder="dd/mm/yy"
          value={value}
          onChange={(e) => {
            let next = e.target.value
              .replace(/[^0-9.]/g, '')
              .replace(/(\..*)\./g, '$1');
            if (next.length >= 2) next = next.slice(0, 2) + '/' + next.slice(2);
            if (next.length >= 5) next = next.slice(0, 5) + '/' + next.slice(5, 9);
            onChange(next);
            if (next.length >= 8) {
              const date = parseTransactionFormDate(next);
              if (date) setSelectedDate(date);
            }
          }}
          maxLength={10}
          className="w-full pr-10"
        />
        <PopoverTrigger asChild>
          <button
            type="button"
            className="absolute right-3 top-1/2 -translate-y-1/2 text-black hover:text-gray-600 cursor-pointer z-10"
          >
            <CalendarIcon className="w-5 h-5" />
          </button>
        </PopoverTrigger>
      </div>
      <PopoverContent className="w-auto p-0" align="end">
        <Calendar date={selectedDate} onSelect={handleDateSelect} />
      </PopoverContent>
    </Popover>
  );
}
