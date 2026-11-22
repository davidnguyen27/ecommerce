import { describe, expect, it } from 'vitest'
import {
  chatHiddenOn,
  linkifyShopPaths,
  pendingCustomerEntry,
  readConversationId,
  unavailableText,
  viewingProductSlug,
} from '../app/utils/chat.ts'

describe('khung chat', () => {
  it('chỉ nhớ mã cuộc trò chuyện dạng uuid; giá trị lạ hay trống coi như chưa có', () => {
    const id = '7f1c1e10-1234-4abc-8def-0123456789ab'
    expect(readConversationId(id)).toBe(id)
    expect(readConversationId(null)).toBeNull()
    expect(readConversationId('')).toBeNull()
    expect(readConversationId('khong-phai-uuid')).toBeNull()
  })

  it('không hiện trên trang đặt mua, đặt trước, thanh toán và quản trị; các trang khác thì hiện', () => {
    for (const path of ['/dat-mua', '/dat-truoc/abc', '/thanh-toan-gia-lap', '/admin', '/admin/orders']) {
      expect(chatHiddenOn(path)).toBe(true)
    }
    for (const path of ['/', '/san-pham/air-max', '/gio-hang', '/don-hang/1001', '/tim-kiem', '/administrator']) {
      expect(chatHiddenOn(path)).toBe(false)
    }
  })

  it('biết sản phẩm khách đang xem từ đường dẫn trang sản phẩm', () => {
    expect(viewingProductSlug('/san-pham/nike-air-max-90')).toBe('nike-air-max-90')
    expect(viewingProductSlug('/san-pham/nike-air-max-90/')).toBe('nike-air-max-90')
    expect(viewingProductSlug('/san-pham')).toBeUndefined()
    expect(viewingProductSlug('/tim-kiem')).toBeUndefined()
  })

  it('mỗi lý do không trả lời có câu riêng, câu nào cũng mời gửi cho nhân viên', () => {
    const texts = (['disabled', 'unconfigured', 'exhausted', 'failed'] as const).map(unavailableText)
    expect(new Set(texts).size).toBe(3)
    for (const text of texts) expect(text).toContain('nhân viên')
  })

  it('tin của khách hiện ngay khi gửi, đã cắt khoảng trắng', () => {
    const entry = pendingCustomerEntry('  Có túi đen không?  ', new Date('2026-11-21T03:00:00Z'))
    expect(entry).toMatchObject({ role: 'customer', content: 'Có túi đen không?', failed: false, cards: [] })
  })
})

describe('link trong câu trả lời', () => {
  it('đường dẫn sản phẩm, chính sách viết trơn thành link; link markdown sẵn có giữ nguyên', () => {
    expect(linkifyShopPaths('Xem tại: /san-pham/coach-tabby-shoulder-bag-26.')).toBe(
      'Xem tại: [/san-pham/coach-tabby-shoulder-bag-26](/san-pham/coach-tabby-shoulder-bag-26).',
    )
    expect(linkifyShopPaths('Chi tiết ở /trang/chinh-sach-doi-tra')).toBe(
      'Chi tiết ở [/trang/chinh-sach-doi-tra](/trang/chinh-sach-doi-tra)',
    )
    const markdown = 'Xem [Coach Tabby](/san-pham/coach-tabby) hay [/trang/doi-tra](/trang/doi-tra)'
    expect(linkifyShopPaths(markdown)).toBe(markdown)
    expect(linkifyShopPaths('https://shop.vn/san-pham/abc')).toBe('https://shop.vn/san-pham/abc')
    expect(linkifyShopPaths('Không có link nào')).toBe('Không có link nào')
  })
})
