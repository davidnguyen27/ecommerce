/** `skip` và `take` của Prisma cho trang `page` (đánh số từ 1). */
export const pageWindow = ({ page, pageSize }: { page: number; pageSize: number }) => ({
  skip: (page - 1) * pageSize,
  take: pageSize,
})
