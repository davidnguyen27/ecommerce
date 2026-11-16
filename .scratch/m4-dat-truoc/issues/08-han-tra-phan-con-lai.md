# 08: Nhắc và quá hạn trả phần còn lại

**What to build:**
- Hai ngày trước hạn trả phần còn lại, khách nhận email nhắc. Quá hạn thì đơn bị gắn cờ "Quá hạn trả phần còn lại" nhưng vẫn giữ hàng và vẫn trả được; không tự hủy, không mất cọc (M6).

**Blocked by:** 07

**Status:** resolved

- [x] Đơn có thời điểm đã nhắc và `remainder_overdue_at`
- [x] Job pg-boss định kỳ mỗi giờ: nhắc đơn `deposit_paid` đã về hàng, chưa nhắc, còn ≤ 2 ngày; gắn cờ đơn quá `remainder_due_at` vẫn `deposit_paid`, ghi sự kiện đơn. Chạy nhiều lần cho một kết quả
- [x] Trả phần còn lại sau khi quá hạn vẫn được (ticket 07 xóa cờ)
- [x] Trang đơn của khách hiện hạn trả và trạng thái quá hạn
- [x] Test (gọi thẳng hàm job với `now` ở tương lai, kiểm qua HTTP): nhắc đúng một lần trong cửa sổ, không nhắc đơn chưa về hàng hoặc đã `paid`; quá hạn gắn cờ, không hủy, hàng vẫn giữ; trả sau quá hạn thì `paid` và hết cờ; chạy lại không gửi thêm, không ghi thêm sự kiện

Spec: mục "Hạn trả phần còn lại".

**Quyết định khi triển khai (2026-11-16):**
- Migration `20261116000400_remainder_deadline`: thêm `order.remainder_reminded_at` và `remainder_overdue_at`, với check `order_remainder_deadline_check` (chỉ đơn đã về hàng mới có hai cột này). Đã đối chiếu với schema trên Postgres tạm: không lệch.
- `processRemainderDeadlines(deps, now)` (`api/src/preorders/deadlines.ts`), job pg-boss `remainder-deadlines` chạy `0 * * * *`:
  - Nhắc: đơn đặt trước `processing` + `deposit_paid`, đã về hàng, chưa nhắc, có `now < remainder_due_at <= now + 2 ngày` → ghi `remainder_reminded_at`, sự kiện `remainder_reminded`, email "Nhắc trả phần còn lại đơn đặt trước #…" (số tiền, hạn theo giờ Việt Nam, link trang đơn có token mới; bản nháp chờ chủ doanh nghiệp duyệt).
  - Quá hạn: đơn như trên mà `remainder_due_at <= now` và chưa có cờ → ghi `remainder_overdue_at`, sự kiện `remainder_overdue` (`data.remainderDueAt`). Không gửi email, không hủy đơn, không nhả hàng.
  - Mỗi đơn chạy trong transaction riêng, khóa đơn `FOR UPDATE` (cùng khóa với `recordPayment`) rồi kiểm lại điều kiện, nên chạy lại hay chạy song song với lúc khách trả tiền vẫn cho một kết quả.
  - Nếu job ngưng lâu tới khi đơn đã quá hạn thì không nhắc nữa, chỉ gắn cờ.
- `recordPayment`: nhánh trả đủ đặt `remainder_overdue_at = null` (xóa cờ; đây là việc ticket 07 để lại). Lịch sử vẫn giữ sự kiện `remainder_overdue`.
- `OrderPreorder.remainderOverdueAt`. Trang đơn của khách: khối trả phần còn lại chuyển màu vàng và ghi "Đã quá hạn trả phần còn lại (…). Hàng vẫn được giữ và bạn vẫn có thể trả …; shop sẽ liên hệ với bạn." Trang đơn admin thêm chữ "Quá hạn trả phần còn lại". Nhãn hai sự kiện mới.
- Test:
  - `api/test/preorder-deadlines.test.ts` (5 test, có kiểm lịch pg-boss bằng SQL như `order-cancel.test.ts`);
  - `depositedPreorder` cùng các hằng `DEPOSIT`, `REMAINING`, `paid` chuyển từ test ticket 07 sang `api/test/support/preorder.ts` để hai file dùng chung.
  Toàn bộ bộ test API (48 file, 519 test) và test web (12) qua.
