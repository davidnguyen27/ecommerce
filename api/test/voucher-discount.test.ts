// Hàm tính giảm là logic thuần nhiều nhánh, không có đường HTTP riêng: test gọi thẳng hàm (CODING_STANDARDS, ngoại lệ).
// Hành vi qua báo giá và tạo đơn được test ở ticket 03 và 04.
import { describe, expect, it } from 'vitest'
import { computeDiscount, type DiscountLine, type DiscountRule } from '../src/vouchers/discount.ts'

const line = (
  variantId: string,
  price: number,
  quantity = 1,
  brandId = 'nike',
  categoryPath = ['giay', 'sneaker'],
): DiscountLine => ({
  variantId,
  brandId,
  categoryPath,
  price: BigInt(price),
  quantity,
})

const percent = (value: number, maxDiscount: number, extra: Partial<DiscountRule> = {}): DiscountRule =>
  ({
    kind: 'percent',
    percent: value,
    maxDiscount: BigInt(maxDiscount),
    minSubtotal: 0n,
    brandIds: [],
    categoryIds: [],
    ...extra,
  }) as DiscountRule

const fixed = (amount: number, extra: Partial<DiscountRule> = {}): DiscountRule =>
  ({ kind: 'fixed', amount: BigInt(amount), minSubtotal: 0n, brandIds: [], categoryIds: [], ...extra }) as DiscountRule

const sumLines = (result: ReturnType<typeof computeDiscount>) =>
  result.ok ? result.lines.reduce((sum, l) => sum + l.discount, 0n) : null

describe('mức giảm', () => {
  it('giảm số tiền cố định', () => {
    const result = computeDiscount([line('a', 1_000_000)], fixed(200_000))
    expect(result).toEqual({ ok: true, discount: 200_000n, lines: [{ variantId: 'a', discount: 200_000n }] })
  })

  it('giảm theo tỷ lệ, làm tròn xuống tới 1.000 VND', () => {
    // 7% của 1.234.567 = 86.419,69 → 86.000
    const result = computeDiscount([line('a', 1_234_567)], percent(7, 10_000_000))
    expect(result.ok && result.discount).toBe(86_000n)
  })

  it('giảm theo tỷ lệ không vượt mức giảm tối đa', () => {
    const result = computeDiscount([line('a', 10_000_000)], percent(20, 500_000))
    expect(result.ok && result.discount).toBe(500_000n)
  })

  it('tỷ lệ tính trên tổng số lượng của dòng', () => {
    const result = computeDiscount([line('a', 1_000_000, 3)], percent(10, 10_000_000))
    expect(result.ok && result.discount).toBe(300_000n)
  })

  it('mức cố định lớn hơn 50% tiền hàng chỉ được giảm tới 50%', () => {
    const result = computeDiscount([line('a', 1_000_000)], fixed(800_000))
    expect(result.ok && result.discount).toBe(500_000n)
  })

  it('trần 50% làm tròn xuống tới 1.000 VND', () => {
    // 50% của 1.001.999 = 500.999,5 → 500.000
    const result = computeDiscount([line('a', 1_001_999)], fixed(900_000))
    expect(result.ok && result.discount).toBe(500_000n)
  })

  it('tỷ lệ 50% có mức tối đa lớn thì đúng bằng trần', () => {
    const result = computeDiscount([line('a', 3_000_000)], percent(50, 10_000_000))
    expect(result.ok && result.discount).toBe(1_500_000n)
  })
})

describe('đơn tối thiểu', () => {
  it('chưa đạt đơn tối thiểu thì báo số còn thiếu', () => {
    const result = computeDiscount([line('a', 1_800_000)], fixed(100_000, { minSubtotal: 2_000_000n }))
    expect(result).toEqual({ ok: false, reason: 'below_minimum', shortfall: 200_000n })
  })

  it('đúng bằng đơn tối thiểu thì được giảm', () => {
    const result = computeDiscount([line('a', 2_000_000)], fixed(100_000, { minSubtotal: 2_000_000n }))
    expect(result.ok).toBe(true)
  })

  it('chỉ tính tiền hàng của các dòng thuộc phạm vi', () => {
    // Nike 3.000.000 thuộc phạm vi, Dior 2.000.000 không: tối thiểu 3.500.000 thì chưa đạt dù tổng đơn 5.000.000.
    const lines = [line('nike', 3_000_000), line('dior', 2_000_000, 1, 'dior', ['nuoc-hoa'])]
    const result = computeDiscount(lines, fixed(100_000, { minSubtotal: 3_500_000n, brandIds: ['nike'] }))
    expect(result).toEqual({ ok: false, reason: 'below_minimum', shortfall: 500_000n })
  })
})

describe('phạm vi', () => {
  const nike = line('nike', 3_000_000, 1, 'nike', ['giay', 'sneaker'])
  const adidasSneaker = line('adidas', 2_000_000, 1, 'adidas', ['giay', 'sneaker'])
  const nikeShirt = line('nike-ao', 1_000_000, 1, 'nike', ['quan-ao', 'ao-thun'])

  it('theo thương hiệu: chỉ giảm dòng của thương hiệu đó, tính trên tiền hàng của dòng đó', () => {
    const result = computeDiscount([nike, adidasSneaker], percent(10, 10_000_000, { brandIds: ['nike'] }))
    expect(result).toEqual({
      ok: true,
      discount: 300_000n,
      lines: [
        { variantId: 'nike', discount: 300_000n },
        { variantId: 'adidas', discount: 0n },
      ],
    })
  })

  it('theo danh mục cha thì gồm cả dòng thuộc danh mục cháu', () => {
    const result = computeDiscount([nike, nikeShirt], percent(10, 10_000_000, { categoryIds: ['giay'] }))
    expect(result.ok && result.discount).toBe(300_000n)
    expect(result.ok && result.lines.find((l) => l.variantId === 'nike-ao')?.discount).toBe(0n)
  })

  it('có cả thương hiệu và danh mục thì dòng phải thỏa cả hai', () => {
    const result = computeDiscount(
      [nike, adidasSneaker, nikeShirt],
      percent(10, 10_000_000, { brandIds: ['nike'], categoryIds: ['sneaker'] }),
    )
    expect(result.ok && result.discount).toBe(300_000n)
  })

  it('không dòng nào thuộc phạm vi thì mã không áp dụng', () => {
    const result = computeDiscount([adidasSneaker], fixed(100_000, { brandIds: ['nike'] }))
    expect(result).toEqual({ ok: false, reason: 'not_applicable' })
  })

  it('cả hai danh sách trống là toàn bộ cửa hàng', () => {
    const result = computeDiscount([nike, adidasSneaker, nikeShirt], percent(10, 10_000_000))
    expect(result.ok && result.discount).toBe(600_000n)
  })
})

describe('chia xuống dòng đơn', () => {
  it('chia theo tỷ lệ tiền hàng, phần lẻ vào dòng có tiền hàng lớn nhất', () => {
    // 100.000 chia 1:1:1 → 33.333 mỗi dòng, lẻ 1 đồng vào dòng lớn nhất (dòng b).
    const lines = [line('a', 1_000_000), line('b', 1_000_001), line('c', 999_999)]
    const result = computeDiscount(lines, fixed(100_000))
    expect(result.ok && result.lines).toEqual([
      { variantId: 'a', discount: 33_333n },
      { variantId: 'b', discount: 33_334n },
      { variantId: 'c', discount: 33_333n },
    ])
  })

  it('các dòng bằng nhau thì phần lẻ vào dòng đầu', () => {
    const result = computeDiscount([line('a', 1_000_000), line('b', 1_000_000), line('c', 1_000_000)], fixed(100_000))
    expect(result.ok && result.lines.map((l) => l.discount)).toEqual([33_334n, 33_333n, 33_333n])
  })

  it('tổng tiền giảm các dòng luôn bằng tiền giảm của đơn', () => {
    // Sinh ngẫu nhiên có hạt giống cố định để lỗi lặp lại được.
    let seed = 42
    const random = (n: number) => {
      seed = (seed * 1_103_515_245 + 12_345) % 2 ** 31
      return seed % n
    }
    for (let round = 0; round < 500; round++) {
      const lines = Array.from({ length: 1 + random(6) }, (_, i) =>
        line(
          `v${i}`,
          1_000 + random(20_000_000),
          1 + random(5),
          random(2) ? 'nike' : 'dior',
          random(2) ? ['giay'] : ['nuoc-hoa'],
        ),
      )
      const rule = random(2)
        ? fixed(1_000 + random(5_000_000), { brandIds: random(2) ? ['nike'] : [] })
        : percent(1 + random(50), 1_000 + random(5_000_000), { categoryIds: random(2) ? ['giay'] : [] })
      const result = computeDiscount(lines, rule)
      if (!result.ok) continue
      expect(sumLines(result)).toBe(result.discount)
      for (const l of result.lines) expect(l.discount >= 0n).toBe(true)
    }
  })
})
