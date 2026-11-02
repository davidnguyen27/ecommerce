const STORAGE_KEY = 'cart'

/**
 * Giỏ hàng chỉ nằm ở localStorage (spec "Giỏ hàng"), server không biết. Giỏ nạp sau khi mount, nên lúc SSR và lúc
 * hydrate giỏ đều rỗng và `ready` là false; phần nào phụ thuộc giỏ chỉ hiện khi `ready`.
 */
export function useCart() {
  const lines = useState<SavedCartLine[]>('cart', () => [])
  const ready = useState('cart-ready', () => false)

  function load() {
    if (ready.value) return
    lines.value = readCart(readStorage())
    ready.value = true
    // Giỏ đổi ở tab khác thì tab này cập nhật theo.
    window.addEventListener('storage', (event) => {
      if (event.key === STORAGE_KEY) lines.value = readCart(event.newValue)
    })
  }
  if (import.meta.client) onMounted(load)

  function save(next: SavedCartLine[]) {
    lines.value = next
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
    } catch {
      // Hết chỗ hoặc trình duyệt chặn: giỏ vẫn dùng được trong trang này, chỉ không còn sau khi tải lại.
    }
  }

  /** Thêm một cái của biến thể; trả lý do khi không thêm được. */
  function add(item: { variantId: string; price: number }) {
    const result = addToCart(lines.value, item)
    if (result.ok) save(result.lines)
    return result
  }

  return {
    lines: readonly(lines),
    ready: readonly(ready),
    count: computed(() => cartCount(lines.value)),
    quantityOf: (variantId: string) => lines.value.find((line) => line.variantId === variantId)?.quantity ?? 0,
    add,
    setQuantity: (variantId: string, quantity: number) => save(setQuantity(lines.value, variantId, quantity)),
    remove: (variantId: string) => save(removeLine(lines.value, variantId)),
    acceptPrices: (quoted: Parameters<typeof acceptQuotedPrices>[1]) => save(acceptQuotedPrices(lines.value, quoted)),
  }
}

function readStorage() {
  try {
    return localStorage.getItem(STORAGE_KEY)
  } catch {
    return null
  }
}
