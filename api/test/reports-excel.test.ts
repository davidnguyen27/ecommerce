import ExcelJS from 'exceljs'
import { describe, expect, it } from 'vitest'
import { shop } from './support/shop.ts'
import { bearer, createStaff, type Request } from './support/staff.ts'
import { adjust } from './support/stock.ts'

const SHIPMENT = { carrier: 'Giao Hàng Nhanh', trackingNumber: 'GHN1' }
const DAY = 24 * 60 * 60_000
/** Vietnam-time calendar day, `days` days from today. */
const vnDate = (days = 0) => new Date(Date.now() + 7 * 60 * 60_000 + days * DAY).toISOString().slice(0, 10)
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

const REPORTS = [
  {
    name: 'revenue',
    slug: 'doanh-thu',
    title: 'Báo cáo doanh thu',
    sheets: ['Theo kỳ', 'Nhóm hàng', 'Thương hiệu', 'Top SKU'],
  },
  { name: 'collections', slug: 'tien-thu', title: 'Báo cáo tiền thu', sheets: ['Theo kỳ', 'Tại thời điểm xuất'] },
  { name: 'stock', slug: 'xuat-nhap-ton', title: 'Báo cáo xuất nhập tồn', sheets: ['Xuất nhập tồn'] },
  { name: 'vouchers', slug: 'ma-giam-gia', title: 'Báo cáo mã giảm giá', sheets: ['Mã giảm giá'] },
  {
    name: 'cancellations',
    slug: 'huy-hoan-tien',
    title: 'Báo cáo hủy đơn và hoàn tiền',
    sheets: ['Tổng quan', 'Tỷ lệ hủy', 'Hủy theo lý do', 'Đơn bỏ dở', 'Hoàn tiền'],
  },
  {
    name: 'returns',
    slug: 'doi-tra',
    title: 'Báo cáo đổi trả và bảo hành',
    sheets: ['Yêu cầu', 'Theo lý do', 'Tỷ lệ trả', 'Bảo hành'],
  },
]

const download = async (request: Request, token: string, name: string, query: Record<string, string>) => {
  const res = await request.get(`/api/admin/reports/${name}.xlsx`).query(query).set(bearer(token)).responseType('blob')
  const workbook = new ExcelJS.Workbook()
  if (res.status === 200) await workbook.xlsx.load(res.body as ArrayBuffer)
  return { res, workbook }
}

/** Every cell value in the file, to check no customer personal data leaks. */
const allText = (workbook: ExcelJS.Workbook) => {
  const values: string[] = []
  workbook.eachSheet((sheet) => sheet.eachRow((row) => row.eachCell((cell) => values.push(String(cell.value)))))
  return values.join('\n')
}

describe('xuất Excel báo cáo', () => {
  it('sáu báo cáo: đúng loại file, tên file theo kỳ, dòng tiêu đề, đủ sheet; không có email hay số điện thoại của khách', async () => {
    const app = await shop({ simulator: true })
    const { request, token } = app
    const placed = (await app.checkout()).body as { code: number }
    await request.post('/api/payments/simulator/paid').send({ orderCode: placed.code, amount: 2_030_000 })
    for (const [path, body] of [['prepare'], ['hand-over', SHIPMENT], ['deliver']] as const) {
      expect(
        (await request.post(`/api/admin/orders/${placed.code}/${path}`).set(bearer(token)).send(body)).status,
      ).toBe(200)
    }
    const query = { from: vnDate(-1), to: vnDate() }

    for (const report of REPORTS) {
      const { res, workbook } = await download(request, token, report.name, query)

      expect(res.status).toBe(200)
      expect(res.headers['content-type']).toContain(XLSX)
      expect(res.headers['content-disposition']).toContain(`bao-cao-${report.slug}-${query.from}-${query.to}.xlsx`)
      expect(workbook.worksheets.map((s) => s.name)).toEqual(report.sheets)
      const heading = String(workbook.worksheets[0]!.getCell('A1').value)
      expect(heading).toContain(report.title)
      expect(heading).toContain('Xuất lúc')
      const text = allText(workbook)
      expect(text).not.toContain('an@example.com')
      expect(text).not.toContain('0912345678')
      expect(text).not.toContain('Nguyễn Văn An')
    }
  })

  it('ô số khớp bản JSON và có định dạng nghìn; tỷ lệ là ô phần trăm', async () => {
    const app = await shop({ simulator: true })
    const { request, token } = app
    const placed = (await app.checkout()).body as { code: number }
    await request.post('/api/payments/simulator/paid').send({ orderCode: placed.code, amount: 2_030_000 })
    for (const [path, body] of [['prepare'], ['hand-over', SHIPMENT], ['deliver']] as const) {
      await request.post(`/api/admin/orders/${placed.code}/${path}`).set(bearer(token)).send(body)
    }
    const query = { from: vnDate(), to: vnDate() }
    const json = (await request.get('/api/admin/reports/revenue').query(query).set(bearer(token))).body

    const { workbook } = await download(request, token, 'revenue', query)
    const sheet = workbook.getWorksheet('Theo kỳ')!
    expect(sheet.getRow(2).getCell(5).value).toBe('Doanh thu gộp')
    const total = sheet.getRow(sheet.rowCount)
    expect(total.getCell(1).value).toBe('Tổng')
    expect(total.getCell(5).value).toBe(json.total.gross)
    expect(total.getCell(5).value).toBe(2_000_000)
    expect(total.getCell(5).numFmt).toBe('#,##0')
    expect(sheet.getRow(3).getCell(1).value).toBe(query.from.split('-').reverse().join('/'))

    const cancellations = await download(request, token, 'cancellations', query)
    const rate = cancellations.workbook.getWorksheet('Tỷ lệ hủy')!.getRow(3).getCell(2)
    expect(rate.value).toBe(0)
    expect(rate.numFmt).toBe('0.0%')
  })

  it('xuất nhập tồn trả mọi dòng theo bộ lọc, không phân trang', async () => {
    const app = await shop()
    const { request, token, v41 } = app
    await adjust(request, token, { variantId: v41.id, reason: 'stocktake', countedQuantity: 1, expectedOnHand: 0 })
    const query = { from: vnDate(), to: vnDate() }

    const all = (await download(request, token, 'stock', query)).workbook.getWorksheet('Xuất nhập tồn')!
    const fragrance = (await download(request, token, 'stock', { ...query, productType: 'fragrance' })).workbook

    expect(all.getColumn(1).values.slice(3)).toEqual(['AM-40', 'AM-41', 'Tổng (2 biến thể)'])
    expect(fragrance.getWorksheet('Xuất nhập tồn')!.getColumn(1).values.slice(3)).toEqual(['Tổng (0 biến thể)'])
  })

  it('cần report.view; kỳ sai thì 400', async () => {
    const { request, token } = await shop()
    const sales = await createStaff(request, token, ['sales'], 'ban-hang@example.com')

    for (const report of REPORTS) {
      const res = await request
        .get(`/api/admin/reports/${report.name}.xlsx`)
        .query({ from: vnDate(), to: vnDate() })
        .set(bearer(sales.accessToken))
      expect(res.status).toBe(403)
    }
    const invalid = await request
      .get('/api/admin/reports/revenue.xlsx')
      .query({ from: vnDate(), to: vnDate(-1) })
      .set(bearer(token))
    expect(invalid.status).toBe(400)
  })
})
