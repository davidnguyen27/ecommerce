/** Prisma `skip` and `take` for page `page` (1-based). */
export const pageWindow = ({ page, pageSize }: { page: number; pageSize: number }) => ({
  skip: (page - 1) * pageSize,
  take: pageSize,
})
