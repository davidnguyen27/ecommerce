// Tạo owner đầu tiên lúc cài đặt. Chạy lại với cùng email thì không tạo thêm và không đổi mật khẩu.
// OWNER_EMAIL=... OWNER_PASSWORD=... OWNER_NAME=... pnpm seed:owner
import { z } from 'zod'
import { seedOwner } from '../auth/staff.ts'
import { createPrisma } from '../db.ts'

const Env = z.object({
  DATABASE_URL: z.string().min(1),
  OWNER_EMAIL: z.email(),
  OWNER_PASSWORD: z.string().min(12, 'Mật khẩu owner cần ít nhất 12 ký tự'),
  OWNER_NAME: z.string().trim().min(1),
})

const env = Env.safeParse(process.env)
if (!env.success) {
  console.error(z.prettifyError(env.error))
  process.exit(1)
}

const prisma = createPrisma(env.data.DATABASE_URL)
try {
  const { created } = await seedOwner(prisma, {
    email: env.data.OWNER_EMAIL,
    password: env.data.OWNER_PASSWORD,
    name: env.data.OWNER_NAME,
  })
  console.log(created ? `Đã tạo owner ${env.data.OWNER_EMAIL}` : `Owner ${env.data.OWNER_EMAIL} đã có, bỏ qua`)
} finally {
  await prisma.$disconnect()
}
