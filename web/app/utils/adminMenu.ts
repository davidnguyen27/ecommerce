import { STOCK_VIEW_PERMISSIONS, type Permission } from '@ecommerce/shared'
import {
  BadgeCheck,
  FileSpreadsheet,
  FileText,
  FolderTree,
  History,
  Images,
  LayoutDashboard,
  ListChecks,
  Package,
  PackagePlus,
  Scale,
  ScrollText,
  Tag,
  Users,
  Warehouse,
  type LucideIcon,
} from 'lucide-vue-next'

export type AdminMenuItem = {
  to: string
  label: string
  icon: LucideIcon
  permission?: Permission | readonly Permission[]
}
export type AdminMenuGroup = { title: string; items: AdminMenuItem[] }

// Quyền của từng trang khai báo một chỗ để menu và lối tắt ở bảng điều khiển không lệch nhau.
export const ADMIN_MENU_GROUPS: AdminMenuGroup[] = [
  {
    title: 'Tổng quan',
    items: [{ to: '/admin', label: 'Bảng điều khiển', icon: LayoutDashboard }],
  },
  {
    title: 'Hàng hóa & Danh mục',
    items: [
      { to: '/admin/products', label: 'Sản phẩm', icon: Package, permission: ['catalog.edit', 'price.edit'] },
      { to: '/admin/import', label: 'Import từ Excel', icon: FileSpreadsheet, permission: 'catalog.edit' },
      { to: '/admin/bulk-images', label: 'Ảnh hàng loạt', icon: Images, permission: 'media.upload' },
      { to: '/admin/brands', label: 'Thương hiệu', icon: Tag, permission: 'catalog.edit' },
      { to: '/admin/categories', label: 'Cây danh mục', icon: FolderTree, permission: 'catalog.edit' },
      { to: '/admin/attribute-schemas', label: 'Schema thuộc tính', icon: ListChecks, permission: 'catalog.edit' },
      { to: '/admin/commitment-types', label: 'Loại cam kết', icon: BadgeCheck, permission: 'commitment.edit' },
    ],
  },
  {
    title: 'Kho',
    items: [
      { to: '/admin/stock', label: 'Tồn kho', icon: Warehouse, permission: STOCK_VIEW_PERMISSIONS },
      { to: '/admin/stock/receipts', label: 'Phiếu nhập', icon: PackagePlus, permission: STOCK_VIEW_PERMISSIONS },
      { to: '/admin/stock/movements', label: 'Sổ xuất nhập', icon: ScrollText, permission: STOCK_VIEW_PERMISSIONS },
    ],
  },
  {
    title: 'Vận hành & Nhân sự',
    items: [
      { to: '/admin/staff', label: 'Nhân sự & Vai trò', icon: Users, permission: 'staff.manage' },
      { to: '/admin/audit', label: 'Nhật ký kiểm toán', icon: History, permission: 'audit.view' },
    ],
  },
  {
    title: 'Nội dung & Pháp lý',
    items: [
      { to: '/admin/pages', label: 'Trang bài viết', icon: FileText, permission: 'content.edit' },
      { to: '/admin/legal-info', label: 'Thông tin pháp lý', icon: Scale, permission: 'content.edit' },
    ],
  },
]

export const ADMIN_MENU_ITEMS = ADMIN_MENU_GROUPS.flatMap((group) => group.items)
