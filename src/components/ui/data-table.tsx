"use client";
import * as React from "react";
import {
  type ColumnDef,
  type SortingState,
  flexRender,
  getSortedRowModel,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  useReactTable,
  type ColumnFiltersState,
  type VisibilityState,
} from "@tanstack/react-table";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/src/components/ui/table";

import { Button } from "@/src/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/src/components/ui/dropdown-menu";
import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "@/src/components/ui/pagination";

interface DataTableProps<TData, TValue> {
  columns: ColumnDef<TData, TValue>[];
  data: TData[] | [];
  filterColumn?: string; // Optional column name for dynamic filtering
}

export function DataTable<TData, TValue>({
  columns,
  data,

}: DataTableProps<TData, TValue>) {
  const [sorting, setSorting] = React.useState<SortingState>([]);
  const [columnFilters, setColumnFilters] = React.useState<ColumnFiltersState>(
    []
  );
  const [columnVisibility, setColumnVisibility] =
    React.useState<VisibilityState>({});
  const [rowSelection, setRowSelection] = React.useState({});

  const table = useReactTable({
    data,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    onSortingChange: setSorting,
    onColumnVisibilityChange: setColumnVisibility,
    onColumnFiltersChange: setColumnFilters,
    onRowSelectionChange: setRowSelection,
    state: {
      sorting,
      columnFilters,
      columnVisibility,
      rowSelection,
    },
  });

  return (
    <div className="p-4 bg-white rounded-md border">
      <div className="flex items-center py-4">
        {/* Dropdown for Column Visibility */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" className="ml-auto">
              Columns
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {table
              .getAllColumns()
              .filter(( column) => column.getCanHide())
              .map((column) => (
                <DropdownMenuCheckboxItem
                  key={column.id}
                  className="capitalize"
                  checked={column.getIsVisible()}
                  onCheckedChange={(value) => column.toggleVisibility(!!value)}
                >
                  {column.id}
                </DropdownMenuCheckboxItem>
              ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <Table>
        <TableHeader className="bg-[#0d61bb]">
          {table.getHeaderGroups().map((headerGroup) => (
            <TableRow key={headerGroup.id}>
              {headerGroup.headers.map((header) => (
                <TableHead key={header.id} className="text-white text-center">
                  {header.isPlaceholder
                    ? null
                    : flexRender(
                        header.column.columnDef.header,
                        header.getContext()
                      )}
                </TableHead>
              ))}
            </TableRow>
          ))}
        </TableHeader>
        <TableBody>
          {table.getRowModel().rows?.length ? (
            table.getRowModel().rows.map((row) => (
              <TableRow
                key={row.id}
                data-state={row.getIsSelected() && "selected"}
              >
                {row.getVisibleCells().map((cell) => (
                  <TableCell key={cell.id}>
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </TableCell>
                ))}
              </TableRow>
            ))
          ) : (
            <TableRow>
              <TableCell colSpan={columns.length} className="h-24 text-center">
                No results.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>

      {/* Pagination */}
      {table.getPageCount() > 1 && (
        <Pagination className="mt-4">
          <PaginationPrevious
            onClick={() => table.getCanPreviousPage() && table.previousPage()}
            className={`${
              table.getCanPreviousPage() ? "enabled-class" : "disabled-class"
            }`}
          >
            Previous
          </PaginationPrevious>

          <PaginationContent>
            {table.getPageCount() > 5 ? (
              <>
                <PaginationItem>
                  <PaginationLink
                    onClick={() => table.setPageIndex(0)}
                    isActive={table.getState().pagination.pageIndex === 0}
                  >
                    1
                  </PaginationLink>
                </PaginationItem>
                {table.getState().pagination.pageIndex > 2 && (
                  <PaginationEllipsis />
                )}
                {Array.from(
                  { length: 5 },
                  (_, i) =>
                    table.getState().pagination.pageIndex - 2 + i >= 1 &&
                    table.getState().pagination.pageIndex - 2 + i <
                      table.getPageCount() && (
                      <PaginationItem key={i}>
                        <PaginationLink
                          onClick={() =>
                            table.setPageIndex(
                              table.getState().pagination.pageIndex - 2 + i
                            )
                          }
                          isActive={
                            table.getState().pagination.pageIndex ===
                            table.getState().pagination.pageIndex - 2 + i
                          }
                        >
                          {table.getState().pagination.pageIndex - 2 + i + 1}
                        </PaginationLink>
                      </PaginationItem>
                    )
                )}
                {table.getState().pagination.pageIndex <
                  table.getPageCount() - 3 && <PaginationEllipsis />}
                <PaginationItem>
                  <PaginationLink
                    onClick={() => table.setPageIndex(table.getPageCount() - 1)}
                    isActive={
                      table.getState().pagination.pageIndex ===
                      table.getPageCount() - 1
                    }
                  >
                    {table.getPageCount()}
                  </PaginationLink>
                </PaginationItem>
              </>
            ) : (
              Array.from({ length: table.getPageCount() }, (_, i) => (
                <PaginationItem key={i}>
                  <PaginationLink
                    onClick={() => table.setPageIndex(i)}
                    isActive={table.getState().pagination.pageIndex === i}
                  >
                    {i + 1}
                  </PaginationLink>
                </PaginationItem>
              ))
            )}
          </PaginationContent>
          <PaginationNext
            onClick={() => table.getCanNextPage() && table.nextPage()}
            className={`${
              table.getCanNextPage() ? "enabled-class" : "disabled-class"
            }`}
          >
            Next
          </PaginationNext>
        </Pagination>
      )}
    </div>
  );
}
