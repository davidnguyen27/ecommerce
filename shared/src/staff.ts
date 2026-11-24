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
  /** Create evidenced commitments and manage commitment types; owner only by default. */
  'commitment.edit',
  /** Receive stock and adjust it. */
  'stock.adjust',
  /** View order lists and details. */
  'order.view',
  /** Fulfill orders: prepare, hand over, deliver, failed delivery, cancel unpaid orders. */
  'order.fulfill',
  /** Reconcile payments: restore orders, close items handled outside the system, resolve by refund. */
  'payment.reconcile',
  /** Cancel paid orders (fully paid or deposited) and propose the refund (M6a). */
  'order.cancel_paid',
  /** Execute refunds: record transfers, refund via gateway, settle results, recreate failed ones (ADR 0014). */
  'payment.refund',
  /** Handle support requests: take, reply, internal notes, status changes, create on behalf of customers (M6b). */
  'support.handle',
  /** Open, edit, close pre-order campaigns; update supply progress and expected delivery. */
  'preorder.manage',
  /** Create, edit, disable vouchers. */
  'voucher.manage',
  /** View reports and the exceptions board, export Excel (M7). */
  'report.view',
  /** Turn the chatbot on/off, read conversations and the chatbot report (M8); owner only by default. */
  'chatbot.manage',
])
export type Permission = z.infer<typeof Permission>

/** The signed-in staff member, with permissions from the current role. */
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
