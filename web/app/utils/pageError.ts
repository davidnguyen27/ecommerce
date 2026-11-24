/**
 * Error loading customer page data: an API 404 is a 404 page; anything else is 502, so it is not taken for a missing
 * page.
 */
export function throwPageError(error: unknown, subject: string): never {
  const notFound = (error as { statusCode?: number }).statusCode === 404
  throw createError({
    statusCode: notFound ? 404 : 502,
    message: notFound ? `Không tìm thấy ${subject}` : `Không tải được ${subject}`,
    fatal: true,
  })
}
