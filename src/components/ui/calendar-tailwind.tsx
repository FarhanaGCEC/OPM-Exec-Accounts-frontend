"use client";

import * as React from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/src/lib/utils";
import { Button } from "./button";
import { formatDisplayYear } from "@/src/lib/formatDisplayDate";

export interface CalendarProps {
  date?: Date | null;
  /**
   * Month/year shown when the calendar opens.
   * Prefer this over `date` (and over today) so period-scoped UIs open on the right month.
   */
  defaultMonth?: Date | null;
  onSelect?: (date: Date | null) => void;
  className?: string;
}

function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

const Calendar: React.FC<CalendarProps> = ({
  date,
  defaultMonth,
  onSelect,
  className,
}) => {
  const [currentDate, setCurrentDate] = React.useState<Date>(() =>
    startOfMonth(defaultMonth ?? date ?? new Date())
  );

  React.useEffect(() => {
    const anchor = defaultMonth ?? date;
    if (anchor) {
      setCurrentDate(startOfMonth(anchor));
    } else {
      setCurrentDate(startOfMonth(new Date()));
    }
  }, [date, defaultMonth]);

  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();

  const firstDayOfMonth = new Date(year, month, 1);
  const lastDayOfMonth = new Date(year, month + 1, 0);
  const daysInMonth = lastDayOfMonth.getDate();
  const startingDayOfWeek = firstDayOfMonth.getDay();

  const monthNames = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
  ];

  const weekDays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  const previousMonth = () => {
    setCurrentDate(new Date(year, month - 1, 1));
  };

  const nextMonth = () => {
    setCurrentDate(new Date(year, month + 1, 1));
  };

  const handleDateClick = (day: number) => {
    const selectedDate = new Date(year, month, day);
    setCurrentDate(selectedDate);
    onSelect?.(selectedDate);
  };

  const isSelected = (day: number): boolean => {
    if (!date) return false;
    return (
      date.getDate() === day &&
      date.getMonth() === month &&
      date.getFullYear() === year
    );
  };

  const isToday = (day: number): boolean => {
    const today = new Date();
    return (
      today.getDate() === day &&
      today.getMonth() === month &&
      today.getFullYear() === year
    );
  };

  const days = [];
  // Empty cells for days before the first day of the month
  for (let i = 0; i < startingDayOfWeek; i++) {
    days.push(null);
  }
  // Days of the month
  for (let day = 1; day <= daysInMonth; day++) {
    days.push(day);
  }

  return (
    <div className={cn("p-4", className)}>
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <Button
          variant="ghost"
          size="icon"
          onClick={previousMonth}
          className="h-8 w-8"
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <div className="text-base font-semibold">
          {monthNames[month]} {formatDisplayYear(year)}
        </div>
        <Button
          variant="ghost"
          size="icon"
          onClick={nextMonth}
          className="h-8 w-8"
        >
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>

      {/* Week days header */}
      <div className="grid grid-cols-7 gap-1 mb-2">
        {weekDays.map((day) => (
          <div
            key={day}
            className="text-center text-sm font-medium text-gray-500 py-2"
          >
            {day}
          </div>
        ))}
      </div>

      {/* Calendar grid */}
      <div className="grid grid-cols-7 gap-1">
        {days.map((day, index) => {
          if (day === null) {
            return <div key={`empty-${index}`} className="aspect-square" />;
          }

          const selected = isSelected(day);
          const today = isToday(day);

          return (
            <button
              key={day}
              type="button"
              onClick={() => handleDateClick(day)}
              className={cn(
                "aspect-square rounded-md text-base font-medium transition-colors",
                "hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-1",
                selected
                  ? "bg-blue-600 text-white hover:bg-blue-700"
                  : today
                  ? "bg-blue-50 text-blue-600 font-semibold"
                  : "text-gray-700"
              )}
            >
              {day}
            </button>
          );
        })}
      </div>
    </div>
  );
};

export default Calendar;

