import type { Permission } from '@ecommerce/shared'

declare module '#app' {
  interface PageMeta {
    /** Permission trang quản trị cần có (danh sách: có ít nhất một); middleware `admin-auth` kiểm tra. */
    permission?: Permission | readonly Permission[]
  }
}

export {}
