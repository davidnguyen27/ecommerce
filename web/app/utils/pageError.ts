/** Lỗi khi tải dữ liệu trang khách: API trả 404 thì trang 404; lỗi khác là 502 để không bị coi là trang không tồn tại. */
export function throwPageError(error: unknown, subject: string): never {
  const notFound = (error as { statusCode?: number }).statusCode === 404
  throw createError({
    statusCode: notFound ? 404 : 502,
    message: notFound ? `Không tìm thấy ${subject}` : `Không tải được ${subject}`,
    fatal: true,
  })
}
