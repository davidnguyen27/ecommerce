import { Permission, type StaffRole } from '@ecommerce/shared'

const ROLE_PERMISSIONS: Record<StaffRole, readonly Permission[]> = {
  owner: Permission.options,
  sales: ['catalog.edit', 'media.upload', 'content.edit'],
  warehouse: ['catalog.edit', 'media.upload', 'document.view', 'stock.adjust', 'order.fulfill'],
  accountant: ['price.edit', 'document.view', 'audit.view'],
}

export function permissionsOf(roles: readonly StaffRole[]): Permission[] {
  return Permission.options.filter((permission) => roles.some((role) => ROLE_PERMISSIONS[role].includes(permission)))
}
