import { describe, expect, it } from 'vitest'
import { asksForStaff, dropSentClaims, looksEnglish, stripToolLabels, suggestsSize } from '../src/chat/intent.ts'

describe('bỏ nhãn công cụ lẫn trong câu trả lời', () => {
  it('bỏ nhãn, giữ chữ sau nhãn (câu thật của qwen, 2026-11-22)', () => {
    expect(
      stripToolLabels(
        'Tool: handoff - Tôi sẽ chuyển bạn qua cho nhân viên, bạn vui lòng nhấn nút xác nhận bên dưới nhé!\nRất xin lỗi bạn.',
      ),
    ).toBe('Tôi sẽ chuyển bạn qua cho nhân viên, bạn vui lòng nhấn nút xác nhận bên dưới nhé!\nRất xin lỗi bạn.')
  })

  it('dòng chỉ có nhãn thì bỏ cả dòng; nhãn dạng gọi hàm, trong ngoặc vuông', () => {
    expect(stripToolLabels('Tool: handoff\n\nBạn bấm nút xác nhận bên dưới nhé.')).toBe(
      'Bạn bấm nút xác nhận bên dưới nhé.',
    )
    expect(stripToolLabels('[Tool call: get_product(slug="air-max")]\nGiá 3.490.000 đ.')).toBe('Giá 3.490.000 đ.')
    expect(stripToolLabels('Có 2 mẫu:\nFunction: search_products: Air Max 90')).toBe('Có 2 mẫu:\nAir Max 90')
  })

  it('không có nhãn đầu dòng thì giữ nguyên văn', () => {
    for (const text of [
      'Giá 3.490.000 đ.\n\n- Màu đen: còn hàng',
      'Bộ dụng cụ: kéo, kìm (Tool: không bán lẻ).',
      'Tools: chưa có.',
    ]) {
      expect(stripToolLabels(text)).toBe(text)
    }
  })
})

describe('bỏ câu nói đã gửi cho nhân viên', () => {
  it('bỏ câu "đã gửi", giữ câu mời bấm nút (câu thật của qwen, chatbot-check 2026-11-21)', () => {
    expect(
      dropSentClaims(
        'Mình đã gửi yêu cầu chuyển cho nhân viên. Bạn vui lòng bấm nút xác nhận bên dưới để được hỗ trợ nhé.',
        false,
      ),
    ).toBe('Bạn vui lòng bấm nút xác nhận bên dưới để được hỗ trợ nhé.')
  })

  it('không còn lời mời thì thêm lời mời theo ngôn ngữ của khách', () => {
    expect(dropSentClaims('Yêu cầu của bạn đã được chuyển tới nhân viên!', false)).toBe(
      'Bạn bấm nút "Gặp nhân viên" bên dưới để gửi câu hỏi cho nhân viên nhé.',
    )
    expect(dropSentClaims("Sorry about that. I've forwarded your request to our staff.", true)).toBe(
      'Sorry about that.\n\nPress the "Gặp nhân viên" button below to send your question to our staff.',
    )
    expect(dropSentClaims('Your request has been sent to the support team.', true)).toContain('Press the')
  })

  it('câu không tự nhận đã gửi thì giữ nguyên văn', () => {
    for (const text of [
      'Bạn bấm nút xác nhận bên dưới để mình chuyển câu hỏi cho nhân viên nhé.',
      'Sau khi yêu cầu đã được gửi, nhân viên sẽ phản hồi trong 24 giờ.',
      'Mình đã gửi link sản phẩm ở trên: /san-pham/nike-air-max-90.',
      'Đơn đã gửi đi thì bạn xem ở Tra cứu đơn.',
      'Nothing has been sent yet; press confirm below to reach our staff.',
    ]) {
      expect(dropSentClaims(text, false)).toBe(text)
    }
  })
})

describe('nhận ra khách đòi gặp nhân viên', () => {
  it('có dấu, không dấu, tiếng Anh', () => {
    for (const text of [
      'cho mình gặp nhân viên',
      'gap nhan vien',
      'muốn nói chuyện với người thật',
      'Can I talk to a human?',
      'need a staff',
    ]) {
      expect(asksForStaff(text)).toBe(true)
    }
    for (const text of ['túi này còn không?', 'đổi trả trong bao lâu', 'management'])
      expect(asksForStaff(text)).toBe(false)
  })
})

describe('nhận ra tin tiếng Anh', () => {
  it('tin tiếng Anh thì có; tiếng Việt có dấu hay không dấu thì không', () => {
    for (const text of [
      'Do you have black sneakers under 4 million VND?',
      'What is the price of this bag?',
      'Can I return it?',
    ]) {
      expect(looksEnglish(text)).toBe(true)
    }
    for (const text of [
      'có túi đen không?',
      'co tui den khong',
      'tui Coach Tabby bao hanh the nao',
      'size 41 con khong',
      'Air Max',
    ]) {
      expect(looksEnglish(text)).toBe(false)
    }
  })
})

describe('nhận ra câu gợi ý size', () => {
  it('một câu có size cụ thể và cụm gợi ý thì có; báo còn hàng hay nói không có bảng size thì không', () => {
    for (const text of [
      'Chân dài 25,5 cm thường phù hợp với size EU 41.',
      'Mình gợi ý bạn chọn size 40 nhé',
      'With 25.5 cm feet, EU 41 should fit you.',
      'Chiều dài này tương ứng với cỡ 38,5.',
      'Theo chiều dài chân 25,5 cm, size EU thường tương ứng là 41.',
      'Với chiều dài chân 25,5 cm, size EU khuyên dùng thường là **41**.',
    ]) {
      expect(suggestsSize(text)).toBe(true)
    }
    for (const text of [
      'Size 41 màu đen còn hàng.',
      'Sản phẩm không có bảng size nên mình không thể gợi ý size.',
      'Giá 3.490.000đ, phù hợp ngân sách của bạn. Size 41 còn hàng.',
      'Size EU phù hợp ngân sách 4 triệu: Air Max 90.',
      'Giày size EU, chân 25,5 cm thường đi giày cỡ nào thì mình không đoán được.',
    ]) {
      expect(suggestsSize(text)).toBe(false)
    }
  })
})
