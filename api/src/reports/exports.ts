import type {
  CancellationReport,
  CollectionsReport,
  ReturnsReport,
  RevenueReport,
  StockReport,
  VoucherReport,
} from '@ecommerce/shared'
import type { SheetSpec } from './excel.ts'
import * as L from './labels.ts'

// Each report as Excel sheets, the same tables as the admin page tabs.

const periodLabel = (period: string) => period.split('-').reverse().join('/')
const num = (header: string) => ({ header, format: 'number' as const })
const pct = (header: string) => ({ header, format: 'percent' as const })
const text = (header: string, width?: number) => ({ header, width })

export function revenueSheets(r: RevenueReport): SheetSpec[] {
  const figures = (f: RevenueReport['total']) => [
    f.deliveredOrders,
    f.grossStandard,
    f.grossPreorder,
    f.gross,
    f.returns,
    f.net,
    f.shippingFees,
    f.forfeitedDeposits,
  ]
  const sales = (header: string, rows: { label: string; quantity: number; gross: number }[]): SheetSpec => ({
    name: header,
    columns: [text(header), num('Số lượng'), num('Doanh thu gộp')],
    rows: rows.map((row) => [row.label, row.quantity, row.gross]),
  })
  return [
    {
      name: 'Theo kỳ',
      columns: [
        text(r.groupBy === 'day' ? 'Ngày' : 'Tháng', 14),
        num('Đơn đã giao'),
        num('Hàng sẵn'),
        num('Đặt trước'),
        num('Doanh thu gộp'),
        num('Hàng trả lại'),
        num('Doanh thu thuần'),
        num('Phí giao'),
        num('Mất cọc'),
      ],
      rows: r.rows.map((row) => [periodLabel(row.period), ...figures(row)]),
      total: ['Tổng', ...figures(r.total)],
    },
    sales(
      'Nhóm hàng',
      r.byProductType.map((row) => ({ ...row, label: L.PRODUCT_TYPE[row.productType] })),
    ),
    sales(
      'Thương hiệu',
      r.byBrand.map((row) => ({ ...row, label: row.brandName })),
    ),
    {
      name: 'Top SKU',
      columns: [text('SKU', 18), text('Sản phẩm', 32), num('Số lượng'), num('Doanh thu gộp')],
      rows: r.topSkus.map((row) => [row.sku, row.productName, row.quantity, row.gross]),
    },
  ]
}

export function collectionsSheets(r: CollectionsReport): SheetSpec[] {
  const figures = (f: CollectionsReport['total']) => [
    f.receivedFull,
    f.receivedDeposit,
    f.receivedRemainder,
    f.received,
    f.refundedCancellation,
    f.refundedReconciliation,
    f.refundedReturn,
    f.refunded,
    f.net,
  ]
  const s = r.snapshot
  return [
    {
      name: 'Theo kỳ',
      columns: [
        text(r.groupBy === 'day' ? 'Ngày' : 'Tháng', 14),
        num('Trả đủ'),
        num('Tiền cọc'),
        num('Phần còn lại'),
        num('Tiền vào'),
        num('Hoàn do hủy'),
        num('Hoàn do đối soát'),
        num('Hoàn do trả hàng'),
        num('Tiền ra'),
        num('Tiền thu thuần'),
      ],
      rows: r.rows.map((row) => [periodLabel(row.period), ...figures(row)]),
      total: ['Tổng', ...figures(r.total)],
    },
    {
      name: 'Tại thời điểm xuất',
      columns: [text('Chỉ số', 32), num('Số đơn / khoản'), num('Số tiền')],
      rows: [
        ['Cọc đang giữ (đơn đặt trước chưa giao)', s.depositsHeld.count, s.depositsHeld.amount],
        ['Còn phải thu', s.outstanding.count, s.outstanding.amount],
        ['Đang hoàn', s.refunding.count, s.refunding.amount],
        ['Cần đối soát', s.reconciliation.count, s.reconciliation.amount],
      ],
    },
  ]
}

export function stockSheets(r: StockReport): SheetSpec[] {
  const figures = (f: StockReport['totals']) => [
    f.opening,
    f.received,
    f.sold,
    f.returned,
    f.adjustedUp,
    f.adjustedDown,
    f.closing,
  ]
  return [
    {
      name: 'Xuất nhập tồn',
      columns: [
        text('SKU', 18),
        text('Sản phẩm', 32),
        text('Thương hiệu', 18),
        text('Nhóm hàng', 14),
        num('Tồn đầu'),
        num('Nhập'),
        num('Xuất bán'),
        num('Hàng hoàn về'),
        num('Điều chỉnh tăng'),
        num('Điều chỉnh giảm'),
        num('Tồn cuối'),
      ],
      rows: r.items.map((i) => [i.sku, i.productName, i.brandName, L.PRODUCT_TYPE[i.productType], ...figures(i)]),
      total: [`Tổng (${r.total} biến thể)`, null, null, null, ...figures(r.totals)],
    },
  ]
}

export function voucherSheets(r: VoucherReport): SheetSpec[] {
  const figures = (f: VoucherReport['totals']) => [f.redemptions, f.discount, f.netGoods, f.deliveredOrders]
  return [
    {
      name: 'Mã giảm giá',
      columns: [
        text('Mã', 16),
        text('Loại', 18),
        num('Số lượt'),
        num('Tiền giảm'),
        num('Tiền hàng sau giảm'),
        num('Đơn đã giao'),
      ],
      rows: r.items.map((i) => [i.code, L.VOUCHER_KIND[i.kind], ...figures(i)]),
      total: ['Tổng', null, ...figures(r.totals)],
    },
  ]
}

export function cancellationSheets(r: CancellationReport): SheetSpec[] {
  const kinds = (c: { standard: number; preorder: number; total: number }) => [c.standard, c.preorder, c.total]
  return [
    {
      name: 'Tổng quan',
      columns: [text('Chỉ số', 28), num('Hàng sẵn'), num('Đặt trước'), num('Tổng')],
      rows: [
        ['Đơn đã xác nhận', ...kinds(r.confirmed)],
        ['Bị hủy khi đã nhận tiền', ...kinds(r.cancelled)],
        ['Đơn bỏ dở', null, null, r.abandonedTotal],
      ],
    },
    {
      name: 'Tỷ lệ hủy',
      columns: [text('Hình thức bán', 20), pct('Tỷ lệ hủy')],
      rows: [
        ['Hàng sẵn', r.rate.standard],
        ['Đặt trước', r.rate.preorder],
        ['Tổng', r.rate.total],
      ],
    },
    {
      name: 'Hủy theo lý do',
      columns: [text('Lý do', 28), num('Hàng sẵn'), num('Đặt trước'), num('Tổng')],
      rows: r.byCause.map((row) => [L.CANCEL_CAUSE[row.cause], ...kinds(row)]),
      total: ['Tổng', ...kinds(r.cancelled)],
    },
    {
      name: 'Đơn bỏ dở',
      columns: [text('Lý do', 24), num('Số đơn')],
      rows: r.abandoned.map((row) => [L.CANCEL_REASON[row.reason], row.count]),
      total: ['Tổng', r.abandonedTotal],
    },
    {
      name: 'Hoàn tiền',
      columns: [text('Nguồn', 16), text('Trạng thái', 18), num('Số khoản'), num('Số tiền')],
      rows: r.refunds.map((row) => [L.REFUND_ORIGIN[row.origin], L.REFUND_STATUS[row.status], row.count, row.amount]),
    },
  ]
}

export function returnsSheets(r: ReturnsReport): SheetSpec[] {
  return [
    {
      name: 'Yêu cầu',
      columns: [text('Loại', 14), num('Chấp nhận'), num('Từ chối'), num('Chưa quyết'), num('Tổng')],
      rows: r.requests.map((row) => [L.RETURN_KIND[row.kind], row.accepted, row.rejected, row.pending, row.total]),
    },
    {
      name: 'Theo lý do',
      columns: [text('Loại', 14), text('Lý do', 20), text('Nhóm hàng', 14), num('Số lượng')],
      rows: r.lines.map((row) => [
        L.RETURN_KIND[row.kind],
        row.reason ? L.RETURN_REASON[row.reason] : null,
        L.PRODUCT_TYPE[row.productType],
        row.quantity,
      ]),
    },
    {
      name: 'Tỷ lệ trả',
      columns: [text('Nhóm hàng', 14), num('Trả'), num('Đã giao'), pct('Tỷ lệ')],
      rows: r.returnRate.map((row) => [L.PRODUCT_TYPE[row.productType], row.returned, row.delivered, row.rate]),
    },
    {
      name: 'Bảo hành',
      columns: [text('Kết quả', 22), num('Số yêu cầu')],
      rows: r.warranty.map((row) => [L.WARRANTY_OUTCOME[row.outcome], row.count]),
      total: ['Tổng', r.warrantyTotal],
    },
  ]
}
