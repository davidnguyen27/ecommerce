import ExcelJS from 'exceljs'
import { REPORT_TIME_ZONE } from './period.ts'

export type Cell = string | number | null
/** A money or quantity cell (`#,##0`), a 0–1 ratio (`0.0%`), or text. */
export type Format = 'number' | 'percent' | 'text'

export type SheetSpec = {
  name: string
  columns: { header: string; format?: Format; width?: number }[]
  rows: Cell[][]
  /** Total row, bold at the bottom. */
  total?: Cell[]
}

export const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

const NUM_FMT: Record<Exclude<Format, 'text'>, string> = { number: '#,##0', percent: '0.0%' }

const exportedAt = (now: Date) =>
  now.toLocaleString('vi-VN', {
    timeZone: REPORT_TIME_ZONE,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })

const vnDate = (date: string) => date.split('-').reverse().join('/')

/**
 * Excel file for a report (spec M7): one sheet per table; row 1 is the report name, period and export time; row 2 the
 * column headers. Money and quantities are numeric cells, so they add up in Excel.
 */
export async function buildWorkbook(
  title: string,
  period: { from: string; to: string } | null,
  sheets: SheetSpec[],
  now = new Date(),
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook()
  const heading = [
    title,
    period && `Kỳ ${vnDate(period.from)} – ${vnDate(period.to)}`,
    `Xuất lúc ${exportedAt(now)} (giờ Việt Nam)`,
  ]
    .filter(Boolean)
    .join(' · ')

  for (const spec of sheets) {
    const sheet = workbook.addWorksheet(spec.name)
    sheet.addRow([heading]).font = { bold: true }
    sheet.addRow(spec.columns.map((c) => c.header)).font = { bold: true }
    const add = (cells: Cell[], bold = false) => {
      const row = sheet.addRow(cells)
      if (bold) row.font = { bold: true }
      spec.columns.forEach((column, i) => {
        const format = column.format ?? 'text'
        if (format !== 'text' && typeof cells[i] === 'number') row.getCell(i + 1).numFmt = NUM_FMT[format]
      })
    }
    for (const cells of spec.rows) add(cells)
    if (spec.total) add(spec.total, true)
    spec.columns.forEach((column, i) => {
      sheet.getColumn(i + 1).width = column.width ?? (column.format === 'text' || !column.format ? 24 : 16)
    })
    sheet.views = [{ state: 'frozen', ySplit: 2 }]
  }
  return Buffer.from(await workbook.xlsx.writeBuffer())
}
