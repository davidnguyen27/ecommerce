import type { Permission } from '@ecommerce/shared'

declare module '#app' {
  interface PageMeta {
    /** Permission an admin page needs (a list: at least one); checked by the `admin-auth` middleware. */
    permission?: Permission | readonly Permission[]
  }
}

export {}
