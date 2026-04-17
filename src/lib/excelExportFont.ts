import type { Font, Workbook } from 'exceljs';
import type { WorkBook, WorkSheet, WritingOptions } from 'xlsx';
import * as XLSX from 'xlsx';

/** Default typeface for all Excel downloads (ExcelJS). */
export const EXCEL_EXPORT_FONT_NAME = 'Arial';

const DEFAULT_SIZE = 11;

/**
 * Build an ExcelJS font object with Arial as the family, merging optional overrides
 * (bold, color, size, etc.).
 */
export function excelExportFont(overrides: Partial<Font> = {}): Partial<Font> {
  const { name: _ignoreName, size: overrideSize, ...rest } = overrides;
  return {
    name: EXCEL_EXPORT_FONT_NAME,
    size: overrideSize ?? DEFAULT_SIZE,
    ...rest,
  };
}

/** SheetJS / xlsx cell style font; use with {@link XLSX_WRITE_WITH_STYLES}. */
export const xlsxSheetFontArial = (overrides: Record<string, unknown> = {}) => ({
  name: EXCEL_EXPORT_FONT_NAME,
  sz: 11,
  ...overrides,
});

/** Use with `XLSX.writeFile(workbook, name, XLSX_WRITE_WITH_STYLES)` so `.s.font` is saved. */
export const XLSX_WRITE_WITH_STYLES: WritingOptions = { cellStyles: true };

/**
 * Force Arial on every populated ExcelJS cell while keeping bold/color/size/etc.
 * Call immediately before `workbook.xlsx.writeBuffer()`.
 */
export function applyArialToExcelJsWorkbook(workbook: Workbook): void {
  workbook.eachSheet((worksheet) => {
    worksheet.eachRow({ includeEmpty: false }, (row) => {
      row.eachCell({ includeEmpty: false }, (cell) => {
        const prev =
          cell.font && typeof cell.font === 'object' ? ({ ...cell.font } as Partial<Font>) : {};
        cell.font = excelExportFont(prev) as Font;
      });
    });
  });
}

/** Apply Arial to every cell in a SheetJS worksheet (preserves bold from existing `.s.font`). */
export function applyXlsxArialToWorksheet(worksheet: WorkSheet): void {
  const ref = worksheet['!ref'];
  if (!ref) return;
  const range = XLSX.utils.decode_range(ref);
  for (let R = range.s.r; R <= range.e.r; R++) {
    for (let C = range.s.c; C <= range.e.c; C++) {
      const addr = XLSX.utils.encode_cell({ r: R, c: C });
      const cell = worksheet[addr];
      if (!cell || typeof cell !== 'object') continue;
      const prev = cell.s ? { ...cell.s } : {};
      const wasBold = !!(
        prev.font &&
        typeof prev.font === 'object' &&
        (prev.font as { bold?: boolean }).bold
      );
      cell.s = {
        ...prev,
        font: xlsxSheetFontArial(wasBold ? { bold: true } : {}),
      };
    }
  }
}

export function applyXlsxArialToWorkbook(workbook: WorkBook): void {
  const names = workbook.SheetNames;
  if (!names?.length) return;
  for (const name of names) {
    const ws = workbook.Sheets[name];
    if (ws) applyXlsxArialToWorksheet(ws);
  }
}
