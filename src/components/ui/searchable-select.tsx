'use client';

import * as React from 'react';
import { Search } from 'lucide-react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from './select';
import { Input } from './input';
import { cn } from '@/src/lib/utils';

interface SearchableSelectProps {
  value?: string;
  onValueChange?: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  children: React.ReactNode;
  searchPlaceholder?: string;
  className?: string;
}

export function SearchableSelect({
  value,
  onValueChange,
  placeholder,
  disabled,
  children,
  searchPlaceholder = 'Search...',
  className,
}: SearchableSelectProps) {
  const [searchQuery, setSearchQuery] = React.useState('');
  const [open, setOpen] = React.useState(false);

  // Filter children based on search query
  const filteredChildren = React.useMemo(() => {
    const items = React.Children.toArray(children).filter(Boolean);
    if (!searchQuery.trim()) return items;

    return items.filter((child) => {
      if (React.isValidElement(child) && child.props) {
        const props = child.props as { children?: React.ReactNode; textValue?: string };
        const childChildren = props.children;

        let childText = '';
        if (typeof props.textValue === 'string' && props.textValue.trim() !== '') {
          childText = props.textValue;
        } else if (typeof childChildren === 'string') {
          childText = childChildren;
        } else if (childChildren != null) {
          childText = React.Children.toArray(childChildren)
            .filter((c) => typeof c === 'string')
            .join(' ');
        }

        return childText.toLowerCase().includes(searchQuery.toLowerCase());
      }
      return true;
    });
  }, [children, searchQuery]);

  const handleOpenChange = (newOpen: boolean) => {
    setOpen(newOpen);
    if (!newOpen) {
      // Clear search when closing
      setSearchQuery('');
    }
  };

  return (
    <Select
      value={value || undefined}
      onValueChange={onValueChange}
      disabled={disabled}
      open={open}
      onOpenChange={handleOpenChange}
    >
      <SelectTrigger className={cn('w-full', className)}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        <div className="px-2 pt-2 pb-1 border-b">
          <div className="relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              type="text"
              placeholder={searchPlaceholder}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-8 h-8 text-sm"
              onClick={(e) => e.stopPropagation()}
              onKeyDown={(e) => {
                e.stopPropagation();
                // Prevent closing select when typing
                if (e.key === 'Escape') {
                  setSearchQuery('');
                }
              }}
            />
          </div>
        </div>
        <div className="max-h-[300px] overflow-y-auto">
          {Array.isArray(filteredChildren) && filteredChildren.length > 0 ? (
            filteredChildren
          ) : (
            <div className="px-2 py-6 text-center text-sm text-muted-foreground">
              No results found
            </div>
          )}
        </div>
      </SelectContent>
    </Select>
  );
}

// Re-export SelectItem for convenience
export { SelectItem };


