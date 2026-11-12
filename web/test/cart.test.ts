import { describe, expect, it } from 'vitest'
import { acceptQuotedPrices, addToCart, cartChanges, readCart, setQuantity } from '../app/utils/cart.ts'

const A = '0b8f6f8e-3c1a-4d5e-9f00-0000000000aa'
const B = '0b8f6f8e-3c1a-4d5e-9f00-0000000000bb'

describe('đọc giỏ hàng từ localStorage', () => {
  it('giỏ hợp lệ thì đọc lại đúng các dòng', () => {
    const raw = JSON.stringify([{ variantId: A, quantity: 2, price: 3_500_000 }])

    expect(readCart(raw)).toEqual([{ variantId: A, quantity: 2, price: 3_500_000 }])
  })

  it('chưa có giỏ, JSON hỏng hoặc sai dạng thì coi như giỏ rỗng', () => {
    const line = { variantId: A, quantity: 1, price: 1 }

    expect(readCart(null)).toEqual([])
    expect(readCart('{không phải json')).toEqual([])
    expect(readCart(JSON.stringify(line))).toEqual([])
    expect(readCart(JSON.stringify([{ ...line, variantId: 'abc' }]))).toEqual([])
    expect(readCart(JSON.stringify([{ ...line, quantity: 9 }]))).toEqual([])
    expect(readCart(JSON.stringify([line, line]))).toEqual([])
  })
})

describe('thêm vào giỏ', () => {
  it('biến thể chưa có thì thêm một dòng với giá đang thấy', () => {
    expect(addToCart([], { variantId: A, price: 3_500_000 })).toEqual({
      ok: true,
      lines: [{ variantId: A, quantity: 1, price: 3_500_000 }],
    })
  })

  it('cùng biến thể thì cộng dồn vào dòng cũ và lấy giá vừa thấy', () => {
    const lines = [
      { variantId: A, quantity: 2, price: 3_500_000 },
      { variantId: B, quantity: 1, price: 900_000 },
    ]

    expect(addToCart(lines, { variantId: A, price: 3_200_000 })).toEqual({
      ok: true,
      lines: [
        { variantId: A, quantity: 3, price: 3_200_000 },
        { variantId: B, quantity: 1, price: 900_000 },
      ],
    })
  })

  it('đã đủ 5 cái của biến thể thì không thêm được, báo giới hạn', () => {
    const lines = [{ variantId: A, quantity: 5, price: 3_500_000 }]

    expect(addToCart(lines, { variantId: A, price: 3_500_000 })).toEqual({ ok: false, reason: 'limit' })
  })

  it('giỏ đã đủ 50 dòng thì không thêm được biến thể mới', () => {
    const lines = Array.from({ length: 50 }, (_, i) => ({
      variantId: `0b8f6f8e-3c1a-4d5e-9f00-${String(i).padStart(12, '0')}`,
      quantity: 1,
      price: 1,
    }))

    expect(addToCart(lines, { variantId: B, price: 1 })).toEqual({ ok: false, reason: 'full' })
  })
})

describe('đổi số lượng', () => {
  it('số lượng nằm ngoài 1–5 thì kẹp về giới hạn gần nhất', () => {
    const lines = [{ variantId: A, quantity: 2, price: 1 }]

    expect(setQuantity(lines, A, 4)).toEqual([{ variantId: A, quantity: 4, price: 1 }])
    expect(setQuantity(lines, A, 9)).toEqual([{ variantId: A, quantity: 5, price: 1 }])
    expect(setQuantity(lines, A, 0)).toEqual([{ variantId: A, quantity: 1, price: 1 }])
  })
})

describe('so giỏ với báo giá', () => {
  const quoted = (variantId: string, fields: { price: number | null; discontinued?: boolean; inStock?: boolean }) => ({
    variantId,
    discontinued: false,
    inStock: true,
    ...fields,
  })

  it('báo dòng đổi giá kèm giá cũ và mới, dòng ngừng bán, dòng hết hàng; dòng không đổi thì không báo', () => {
    const C = '0b8f6f8e-3c1a-4d5e-9f00-0000000000cc'
    const D = '0b8f6f8e-3c1a-4d5e-9f00-0000000000dd'
    const lines = [A, B, C, D].map((variantId) => ({ variantId, quantity: 1, price: 1_000_000 }))

    const changes = cartChanges(lines, [
      quoted(A, { price: 1_200_000 }),
      quoted(B, { price: null, discontinued: true }),
      quoted(C, { price: 1_000_000, inStock: false }),
      quoted(D, { price: 1_000_000 }),
    ])

    expect(changes).toEqual(
      new Map([
        [A, { kind: 'price', from: 1_000_000, to: 1_200_000 }],
        [B, { kind: 'discontinued' }],
        [C, { kind: 'out_of_stock' }],
      ]),
    )
  })

  it('nhận giá mới thì giỏ lưu giá hiện tại, dòng ngừng bán giữ nguyên', () => {
    const lines = [
      { variantId: A, quantity: 2, price: 1_000_000 },
      { variantId: B, quantity: 1, price: 500_000 },
    ]

    const accepted = acceptQuotedPrices(lines, [
      quoted(A, { price: 1_200_000 }),
      quoted(B, { price: null, discontinued: true }),
    ])

    expect(accepted).toEqual([
      { variantId: A, quantity: 2, price: 1_200_000 },
      { variantId: B, quantity: 1, price: 500_000 },
    ])
  })
})
