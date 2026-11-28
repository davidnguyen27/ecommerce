/** Emails are stored trimmed and lowercase, for staff, customers and orders alike. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase()
}
