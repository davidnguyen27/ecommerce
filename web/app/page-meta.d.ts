import type { Permission } from '@ecommerce/shared'

declare module '#app' {
  interface PageMeta {
    /** Permission trang quản trị cần có; middleware `admin-auth` kiểm tra. */
    permission?: Permission
  }
}

export {}
