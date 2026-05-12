"use client";

import React from "react";
import DatePicker from "react-datepicker";
import "react-datepicker/dist/react-datepicker.css";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/src/lib/utils";
import { buttonVariants } from "@/src/components/ui/button";
import { formatDisplayYear } from "@/src/lib/formatDisplayDate";

export type CustomDatePickerProps = {
  value: Date | null;
  onChange: (date: Date | null) => void;
  placeholder?: string;
  minDate?: Date;
  maxDate?: Date;
  disabled?: boolean;
  className?: string;
};

const CustomDatePicker: React.FC<CustomDatePickerProps> = ({
  value,
  onChange,
  placeholder = "Select a date",
  minDate,
  maxDate,
  disabled = false,
  className,
}) => {
  return (
    <div className={cn("relative w-full", className)}>
      <DatePicker
        selected={value}
        onChange={onChange}
        placeholderText={placeholder}
        minDate={minDate}
        maxDate={maxDate}
        disabled={disabled}
        className="w-84 p-2 border border-gray-300 rounded-md text-base focus:ring-2 focus:ring-blue-500 focus:outline-none"
        renderCustomHeader={({ 
          monthDate, 
          decreaseMonth, 
          increaseMonth 
        }: {
          monthDate: Date;
          decreaseMonth: () => void;
          increaseMonth: () => void;
        }) => (
          <div className="flex items-center justify-between px-2 py-1 w-full">
            <button
              onClick={decreaseMonth}
              className={cn(
                buttonVariants({ variant: "ghost" }),
                "flex items-center justify-center w-8 h-8"
              )}
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span className="text-base font-medium">
              {monthDate.toLocaleString("default", { month: "long" })}{" "}
              {formatDisplayYear(monthDate.getFullYear())}
            </span>
            <button
              onClick={increaseMonth}
              className={cn(
                buttonVariants({ variant: "ghost" }),
                "flex items-center justify-center w-8 h-8"
              )}
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        )}
      />
    </div>
  );
};

export default CustomDatePicker;
