// Bảng điều khiển chỉ hiện lối tắt tới trang người đăng nhập mở được (quyền khai ở web/app/utils/adminMenu.ts).
// Kho có `catalog.edit` là có chủ ý (được sửa sản phẩm, danh mục), nhưng không có `content.edit` nên không thấy
// lối tắt soạn chính sách, và không có `audit.view` nên không thấy nhật ký kiểm toán.
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
