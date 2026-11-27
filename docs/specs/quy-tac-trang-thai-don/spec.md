# Spec: Gom quy tắc trạng thái đơn và việc hủy đơn của nhân viên

**Status:** resolved

Nguồn: buổi review kiến trúc backend ngày 2026-11-26 (`/codebase-design`), sau khi đánh giá "tách đủ 6 lớp", "OOP nghiêm ngặt" và "tách máy trạng thái khỏi `fulfill-order.ts`" và gác cả ba lại. Đây là refactor: không đổi contract API, không có migration, không có ADR mới. Có một thay đổi hành vi nhỏ ở web, ghi ở ticket 01.

## Problem Statement

**1. Điều kiện về trạng thái đơn bị chép ở nhiều nơi, và các bản chép đã lệch nhau.**

| Điều kiện | Bản ở API | Bản ở web |
|---|---|---|
| Hủy được đơn đã nhận tiền (M6a) | `orders/cancel-paid-order.ts:48-55` | `pages/admin/orders/[code].vue:21-33` (chép đủ); `pages/admin/support/[code].vue:103` (`canRequestCancel(order) \|\| fulfillmentStatus === 'returned'`) |
| Đã giao xong (`completed` + `delivered`) | `support/support.ts:304` | `pages/admin/support/new.vue:47`, `pages/don-hang/[code].vue:156`, `pages/tai-khoan/don-hang/[code].vue:85` |
| Khách yêu cầu hủy (M6b) | `canRequestCancel` trong `shared/src/orders.ts:381`, API và web cùng gọi. **Đây là mẫu cần theo.** | |

Bản ở trang yêu cầu hỗ trợ không kiểm `status` hay `paymentStatus` khi đơn ở `returned`. Hủy đơn không đổi `fulfillmentStatus`, nên một đơn đã hủy mà vẫn ở `returned` thì trang này vẫn mở form hủy, và API trả 409 khi nhân viên bấm gửi. Lỗi hiếm gặp nhưng cho thấy rủi ro: đổi quy tắc ở API mà quên sửa web thì không test nào bắt được.

**2. Thứ tự các bước khi nhân viên hủy đơn nằm trong route.** Khách hủy và job hết hạn gọi `cancelOrder`, hàm này tự hủy link thanh toán sau khi commit. Route nhân viên (`routes/admin-orders.ts:125-160`) thì tự xếp các bước: `cancelInTransaction`, ghi audit, `assertCancellable`, `cancelPaymentLinks`. Route hủy đơn đã nhận tiền cũng tự gọi `cancelPaymentLinks`. Quy tắc "hủy link sau khi commit" vì thế có ba bản.

**3. Danh sách đơn quản trị dựng truy vấn ngay trong route.** `GET /admin/orders` tự dựng `where` từ 9 bộ lọc rồi map sang `AdminOrderPage` (`routes/admin-orders.ts:72-119`), trong khi chi tiết đơn đã nằm trong module (`loadAdminOrder`).

**4. `adminRoutes` nhận năm tham số theo vị trí** (`routes/admin.ts:37`), trong khi các router khác nhận `deps`.

## Solution

| # | Thay đổi | Nơi |
|---|---|---|
| 01 | Thêm `canCancelPaid` và `isDelivered` vào `shared/src/orders.ts` theo mẫu `canRequestCancel`; API và web cùng gọi | shared, api, web |
| 02 | Đưa việc nhân viên hủy đơn (chưa trả tiền và đã nhận tiền) vào `orders/`; module tự ghi audit trong transaction và tự hủy link sau commit | api |
| 03 | `listAdminOrders(prisma, query)` đặt cạnh `loadAdminOrder` | api |
| 04 | `adminRoutes(deps)` nhận một object như các router khác | api |

## Implementation Decisions

- **Điều kiện ở shared nhận đúng ba trường** `{ status, paymentStatus, fulfillmentStatus }`, như `canRequestCancel`, để dùng được cho cả dòng vừa khóa bằng `FOR UPDATE` lẫn object response ở web.
- **Ở API, điều kiện chạy sau khi khóa**, giữ quy tắc "không kiểm trước rồi mới ghi" (CODING_STANDARDS). Thông điệp lỗi riêng từng nhánh (chưa thanh toán thì dùng nút hủy thường; `failed` thì phải nhận hàng hoàn về trước) vẫn ở API: API kiểm từng nhánh để chọn thông điệp, nhưng điều kiện tổng phải khớp với hàm shared. Test ở ticket 01 chốt điều đó.
- **Transaction có audit được truyền vào module dưới dạng hàm chạy**, không truyền `req`:
  ```ts
  type AuditedRun = <T>(fn: (tx: Prisma.TransactionClient, audit: Audit) => Promise<T>) => Promise<T>
  // route: const run: AuditedRun = (fn) => audited(prisma, req, fn)
  ```
  Module tự quyết định gọi audit hay không (không đổi gì thì không ghi), rồi tự hủy link sau khi `run` trả về.
- Thông điệp lỗi, `fields`, status code và nội dung audit giữ nguyên từng chữ. Thứ tự khóa giữ nguyên.
- Comment tiếng Anh, ngắn (CODING_STANDARDS).

## Testing Decisions

- Bộ test HTTP hiện có là lưới an toàn: `order-cancel.test.ts`, `order-cancel-paid.test.ts`, `preorder-cancel-paid.test.ts`, `admin-orders.test.ts`, `support-cancel.test.ts`, `support-returns.test.ts` và cả bộ test api. Phải xanh mà không sửa test có sẵn.
- Ticket 01 thêm test hàm thuần trong `shared` cho `canCancelPaid` và `isDelivered`: điều kiện ở web không có đường HTTP để kiểm, và các hàm thuần là chỗ duy nhất chốt được web và API dùng chung một quy tắc.
- Mỗi ticket chạy `pnpm --filter api test`, `pnpm typecheck`, `pnpm lint`; ticket 01 chạy thêm `pnpm smoke`.

## Out of Scope

- Chuyển `routes/*.ts` vào thư mục miền (ví dụ `orders/routes/`). Đáng làm, nhưng là đợt di chuyển file lớn; làm riêng khi không có nhánh nào đang mở.
- Repository, service class, DI container, OOP hóa toàn bộ: đã đánh giá và gác lại ngày 2026-11-26. Prisma cùng các hàm nhận `tx` đã là tầng truy cập dữ liệu. Thêm lớp bọc thì phải để lộ `tx` và thứ tự khóa, nên chỉ thành lớp chuyển tiếp.
- Bảng máy trạng thái cho `fulfill-order.ts`: mỗi bước chuyển đã tự khai trạng thái nguồn và đích, phần còn lại khác nhau theo từng bước.
- `FulfillmentPanel.vue` chọn nút theo từng trạng thái giao hàng. Mỗi trạng thái ứng với một nút, nên ít có nguy cơ lệch; để nguyên.

## Further Notes

- Bốn ticket độc lập. Thứ tự gợi ý: 01 → 02 → 03 → 04.
