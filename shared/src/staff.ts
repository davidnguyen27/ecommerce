import { z } from 'zod'

export const StaffRole = z.enum(['owner', 'sales', 'warehouse', 'accountant'])
export type StaffRole = z.infer<typeof StaffRole>

export const Permission = z.enum([
  'staff.manage',
  'catalog.edit',
  'price.edit',
  'media.upload',
  'document.view',
  'content.edit',
  'audit.view',
  /** Tạo cam kết có bằng chứng và quản lý loại cam kết; mặc định chỉ owner. */
  'commitment.edit',
  /** Nhập kho và điều chỉnh tồn. */
  'stock.adjust',
  /** Xem danh sách và chi tiết đơn hàng. */
  'order.view',
  /** Xử lý đơn: chuẩn bị, bàn giao, đã giao, giao thất bại, hủy đơn chưa thanh toán. */
  'order.fulfill',
])
export type Permission = z.infer<typeof Permission>

/** Nhân viên đang đăng nhập, kèm quyền tính từ role hiện tại. */
export const StaffProfile = z.object({
  id: z.string(),
  email: z.string(),
  name: z.string(),
  roles: z.array(StaffRole),
  permissions: z.array(Permission),
})
export type StaffProfile = z.infer<typeof StaffProfile>

const Roles = z
  .array(StaffRole)
  .min(1)
  .transform((roles) => [...new Set(roles)])

export const CreateStaffRequest = z.object({
  email: z.email(),
  name: z.string().trim().min(1),
  password: z.string().min(12),
  roles: Roles,
})
export type CreateStaffRequest = z.infer<typeof CreateStaffRequest>

export const UpdateStaffRequest = z.object({
  email: z.email(),
  name: z.string().trim().min(1),
})
export type UpdateStaffRequest = z.infer<typeof UpdateStaffRequest>

export const ChangeRolesRequest = z.object({ roles: Roles })
export type ChangeRolesRequest = z.infer<typeof ChangeRolesRequest>

export const StaffSummary = z.object({
  id: z.string(),
  email: z.string(),
  name: z.string(),
  roles: z.array(StaffRole),
  locked: z.boolean(),
  createdAt: z.string(),
})
export type StaffSummary = z.infer<typeof StaffSummary>

export const StaffList = z.object({ items: z.array(StaffSummary) })
export type StaffList = z.infer<typeof StaffList>
