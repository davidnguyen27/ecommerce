// The dashboard only shows shortcuts to pages the user can open (permissions in web/app/utils/adminMenu.ts).
// The warehouse role has `catalog.edit` on purpose (edits products, categories), but without `content.edit` it sees no
// policy shortcut, and without `audit.view` no audit log.
import { expect, test, type Page } from '@playwright/test'
import { adminLogin } from '../support/admin-login.ts'
import { WAREHOUSE } from '../support/stack.ts'

const shortcutsOf = (page: Page) =>
  page.locator('.admin-panel', { has: page.getByRole('heading', { name: 'Lối tắt tác vụ' }) }).getByRole('link')

test('nhân viên kho chỉ thấy lối tắt của trang mình mở được', async ({ page }) => {
  await adminLogin(page, WAREHOUSE)
  await expect(page.getByTestId('dashboard-to-pick')).toBeVisible()
  await expect(shortcutsOf(page)).toHaveText([
    'Sản phẩm & Biến thể',
    'Quản lý Thương hiệu & Logo',
    'Cây Danh mục 5 Nhóm hàng',
  ])
  await expect(page.getByRole('heading', { name: 'Kiểm toán gần nhất' })).toHaveCount(0)
})
