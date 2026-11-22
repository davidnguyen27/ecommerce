import { describe, expect, it } from 'vitest'
import { asksForStaff, looksEnglish, suggestsSize } from '../src/chat/intent.ts'

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
