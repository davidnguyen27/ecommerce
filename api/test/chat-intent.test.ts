import { describe, expect, it } from 'vitest'
import { asksForStaff } from '../src/chat/intent.ts'

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
