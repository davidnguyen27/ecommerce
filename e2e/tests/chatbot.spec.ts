// Chatbot (M8), bằng trình duyệt thật trên stack smoke với model giả (`LLM_CHAIN=fake`, `DemoLlm`: tìm sản phẩm bằng
// đúng câu khách hỏi rồi trả lời bằng tên sản phẩm):
// 1. Khách vãng lai hỏi ở trang sản phẩm, thấy thẻ sản phẩm, gửi cho nhân viên; bán hàng thấy yêu cầu "chuyển từ chatbot"
//    kèm bản chép.
// 2. Trình duyệt chặn localStorage thì vẫn chat được.
// 3. Owner tắt chatbot: khung chat báo tạm nghỉ, mời gặp nhân viên; đặt mua vẫn hoàn tất; trang đặt mua không có nút chat.
// Bật, tắt chatbot đi qua API quản trị; spec để chatbot ở trạng thái tắt như mặc định.
import { expect, test, type Page } from '@playwright/test'
import { adminLogin } from '../support/admin-login.ts'
import { buyAndPay, ensureSellable } from '../support/purchase.ts'
import { resetRateLimits } from '../support/rate-limit.ts'
import { AdminApi, PRODUCT_PATH, SALES } from '../support/stack.ts'

const runId = Date.now().toString().slice(-7)
const RESPONSE_TIME = 'Nhân viên trả lời trong giờ hành chính (E2E).'

async function setChatbot(enabled: boolean) {
  const api = await AdminApi.owner()
  await api.send('PUT', '/api/admin/chatbot/settings', { enabled, responseTimeNote: RESPONSE_TIME })
}

async function openChat(page: Page) {
  await page.getByRole('button', { name: 'Hỏi trợ lý' }).click()
  const dialog = page.getByRole('dialog', { name: 'Trợ lý tư vấn' })
  await expect(dialog).toBeVisible()
  return dialog
}

async function ask(page: Page, question: string) {
  const dialog = page.getByRole('dialog', { name: 'Trợ lý tư vấn' })
  await dialog.getByLabel('Câu hỏi').fill(question)
  await dialog.getByLabel('Câu hỏi').press('Enter')
  await expect(dialog.getByText('Đang trả lời…')).toBeHidden({ timeout: 20_000 })
}

test.beforeAll(async () => {
  // Chuyển nhân viên giới hạn 3 lần mỗi IP mỗi ngày; mọi request E2E đi từ một IP.
  resetRateLimits()
  await setChatbot(true)
})

test.afterAll(async () => {
  await setChatbot(false)
})

test('khách vãng lai hỏi, thấy thẻ sản phẩm, gửi cho nhân viên; bán hàng đọc được bản chép', async ({
  page,
  browser,
}) => {
  await page.goto(PRODUCT_PATH)
  const dialog = await openChat(page)
  await expect(dialog.getByText(/xử lý bởi nhà cung cấp AI bên ngoài/)).toBeVisible()

  await ask(page, 'Air Max')
  await expect(dialog.getByText('Mình tìm được: Air Max 90.')).toBeVisible()
  await expect(dialog.getByRole('link', { name: /Air Max 90/ })).toHaveAttribute('href', '/san-pham/air-max-90')

  await dialog.getByRole('button', { name: 'Gặp nhân viên' }).click()
  await dialog.getByLabel('Tên').fill('Khách Chat')
  await dialog.getByLabel('Email').fill(`chat-${runId}@example.com`)
  await dialog.getByLabel(/Lời nhắn/).fill('Mình muốn hỏi thêm về size.')
  await dialog.getByRole('button', { name: 'Gửi cho nhân viên' }).click()
  const done = dialog.getByRole('status')
  await expect(done).toContainText(RESPONSE_TIME)
  const code = /#YC(\d+)/.exec((await done.textContent()) ?? '')?.[1]
  expect(code).toBeTruthy()

  const staff = await browser.newPage()
  await adminLogin(staff, SALES)
  await staff.goto(`/admin/support/${code}`)
  await expect(staff.getByText('chuyển từ chatbot')).toBeVisible()
  await expect(staff.getByText('Mình muốn hỏi thêm về size.')).toBeVisible()
  const transcript = staff.getByRole('region', { name: 'Cuộc trò chuyện với chatbot' })
  await expect(transcript.getByText('Air Max', { exact: true })).toBeVisible()
  await expect(transcript.getByText('Mình tìm được: Air Max 90.')).toBeVisible()
  await staff.close()
})

test('trình duyệt chặn localStorage thì vẫn chat được', async ({ browser }) => {
  const context = await browser.newContext()
  await context.addInitScript(() => {
    const blocked = () => {
      throw new DOMException('Bị chặn', 'SecurityError')
    }
    Storage.prototype.getItem = blocked
    Storage.prototype.setItem = blocked
    Storage.prototype.removeItem = blocked
  })
  const page = await context.newPage()
  await page.goto(PRODUCT_PATH)
  const dialog = await openChat(page)
  await ask(page, 'Air Max')
  await expect(dialog.getByText('Mình tìm được: Air Max 90.')).toBeVisible()
  await context.close()
})

test('chatbot tắt: khung chat báo tạm nghỉ, đặt mua vẫn hoàn tất, trang đặt mua không có nút chat', async ({
  page,
}) => {
  await setChatbot(false)
  await page.goto(PRODUCT_PATH)
  const dialog = await openChat(page)
  await ask(page, 'Air Max')
  await expect(dialog.getByText(/Trợ lý đang tạm nghỉ/)).toBeVisible()
  await expect(dialog.getByText('Chưa có trả lời')).toBeVisible()
  await expect(dialog.getByRole('button', { name: 'Gặp nhân viên' })).toBeVisible()
  await dialog.getByRole('button', { name: 'Đóng' }).click()

  await ensureSellable(1, 'E2E chatbot: bổ sung hàng')
  await buyAndPay(page, 'chatbot', '7')

  await page.goto('/dat-mua')
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Hỏi trợ lý' })).toHaveCount(0)
})
