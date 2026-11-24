const STORAGE_KEY = 'cart'

/**
 * The cart lives only in localStorage (spec "Giỏ hàng"); the server never knows it. It loads after mount, so during SSR
 * and hydration the cart is empty and `ready` is false; anything depending on the cart shows only when `ready`.
 */
export function useCart() {
  const lines = useState<SavedCartLine[]>('cart', () => [])
  const ready = useState('cart-ready', () => false)

  function load() {
    if (ready.value) return
    lines.value = readCart(readStorage())
    ready.value = true
    // A cart change in another tab updates this one.
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
      // Out of space or blocked by the browser: the cart still works on this page, just not after a reload.
    }
  }

  /** Adds one unit of a variant; returns the reason when it cannot. */
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
    /** Empties the cart, after a successful checkout. */
    clear: () => save([]),
  }
}

function readStorage() {
  try {
    return localStorage.getItem(STORAGE_KEY)
  } catch {
    return null
  }
}
