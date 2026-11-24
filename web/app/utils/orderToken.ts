// The order lookup token is kept in the checkout tab's sessionStorage, so the result page (URL has only the order code)
// can open the order when the gateway sends the customer back. The gateway never sees it. Blocked storage is ignored.
const key = (code: number | string) => `order-token:${code}`

export function rememberOrderToken(code: number, token: string) {
  try {
    sessionStorage.setItem(key(code), token)
  } catch {
    // If it cannot be stored, the customer opens the order from the email link.
  }
}

export function recallOrderToken(code: string): string | null {
  try {
    return sessionStorage.getItem(key(code))
  } catch {
    return null
  }
}
