import { describe, expect, it } from 'vitest'
import { asksForStaff, looksEnglish } from '../src/chat/intent.ts'

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
