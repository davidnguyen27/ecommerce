# 05: Ghi nhận cọc

**What to build:**
- Khách trả cọc thành công thì đơn đặt trước thành đã cọc (`deposit_paid`) và đang xử lý, khách nhận email xác nhận. Tiền cọc lệch hoặc về muộn thì vào danh sách cần đối soát, và kế toán khôi phục được đơn nếu đợt còn suất. Đơn đã cọc không hủy được.

**Blocked by:** 04

**Status:** resolved

- [x] Trạng thái thanh toán thêm `deposit_paid`. Cạnh của đơn `preorder`: `unpaid` → `deposit_paid` → `paid`; đơn `standard` không đi qua `deposit_paid`
- [x] Hàm ghi nhận thanh toán: đơn `preorder` đang `pending_payment` và giao dịch `deposit` đúng bằng tiền cọc → `deposit_paid` + `processing`, ghi `deposit_paid_at`, bỏ `reserved_until`, xếp email "đã nhận cọc" (tiền cọc, phần còn lại, thời gian giao dự kiến, link tra cứu). Trường hợp khác vào đối soát với lý do sẵn có. Vẫn chạy nhiều lần cho một kết quả
- [x] Job hết hạn không hủy đơn đã cọc (truy vấn cổng trước như M3)
- [x] Khôi phục từ đối soát với đơn `preorder` đã hủy: tiền đúng bằng tiền cọc và đợt còn đủ suất (không cần đợt đang mở) → `deposit_paid`, `deposit_paid_at` = lúc khôi phục; không đủ suất thì 409
- [x] Hủy đơn `deposit_paid` (khách qua token, tài khoản, nhân viên) đều 409
- [x] Trang đơn của khách và admin hiện "Đã cọc" khác "Đã trả đủ", cùng phần còn lại
- [x] Test qua HTTP: IPN đúng tiền → `deposit_paid`, email một lần, IPN lặp chỉ ghi một lần; lệch tiền → đối soát, đơn vẫn chờ cọc; cọc về sau khi hủy → đối soát; khôi phục được và hết suất thì 409; hủy đơn đã cọc 409; đơn đã cọc chưa soạn hàng được (giao hàng cần `paid`)

Spec: mục "Mô hình đơn", "Thanh toán".

**Quyết định khi triển khai (2026-11-16):**
- Hai migration:
  - `20261116000100_payment_status_deposit_paid`: chỉ `ALTER TYPE … ADD VALUE 'deposit_paid' BEFORE 'paid'`, vì giá trị enum mới chưa dùng được trong cùng transaction;
  - `20261116000200_order_deposit_paid_at`: cột `deposit_paid_at`, index thường (Prisma không biểu diễn được index có `WHERE`), và check `order_deposit_paid_check`. Theo check này, đơn hàng sẵn không bao giờ `deposit_paid` và không có lúc cọc; đơn đặt trước có lúc cọc khi và chỉ khi đang `deposit_paid` hoặc `paid`.
  Đã đối chiếu với schema trên Postgres tạm: không lệch.
- `recordPayment`: mỗi loại đơn được tất toán bằng tổng các khoản **đúng mục đích**: đơn hàng sẵn bằng `full` = tổng phải trả, đơn đặt trước bằng `deposit` = tiền cọc.
  - Khi đủ cọc: đơn thành `processing` + `deposit_paid`, `deposit_paid_at = now()` (giờ server, không lấy giờ của cổng, để thứ tự chia hàng ở ticket 06 ổn định), bỏ `reserved_until`, đóng các mục lệch tiền cũ (`settled_by_payment`), ghi sự kiện `deposit_paid`, xếp email "Đã nhận tiền cọc đơn đặt trước #…" (bản nháp chờ chủ doanh nghiệp duyệt).
  - Lý do đối soát: khoản về khi `paymentStatus` khác `unpaid` (đã cọc hay đã trả đủ) là `extra_payment`, cho tới khi ticket 07 thêm luồng trả phần còn lại.
  - Kết quả có thêm `deposit_paid`; IPN trả `00` như `paid`.
- Khoản về qua link không tìm thấy (mã lạ) vẫn được coi là `full`, như ticket 01. Với đơn đặt trước, khoản đó rơi vào `amount_mismatch`. Với VNPAY thật thì không xảy ra, vì mã link chính là `vnp_TxnRef` của IPN.
- `restoreOrder` với đơn đặt trước đã hủy:
  - so tổng khoản `deposit` với tiền cọc;
  - lấy lại suất: khóa dòng suất `FOR UPDATE`, số đã dùng cộng số lượng của đơn không được vượt suất, không cần đợt đang mở;
  - không giữ hàng;
  - đơn thành `deposit_paid` với `deposit_paid_at` = lúc khôi phục, để không chen lên trước những người cọc trong lúc đơn đã hủy;
  - gửi email đã nhận cọc.
  Hết suất thì 409. Đơn hàng sẵn giờ cũng chỉ cộng khoản `full` khi so tổng (giao dịch cũ đều là `full`).
- Hủy đơn đã cọc: `cancelInTransaction` vốn đã trả `not_pending` cho đơn `processing`, nên chỉ đổi thông báo 409 thành "Đơn đã thanh toán hoặc đã cọc, không hủy được". Job hết hạn bỏ qua đơn đã cọc vì lý do tương tự.
- Soạn hàng vẫn cần `paid` (`lockForTransition` của M3), nên đơn đã cọc nhận 409.
- `OrderPreorder` có thêm `depositPaidAt`. Nhãn thanh toán `deposit_paid` là "Đã cọc", nhãn sự kiện là "Đã nhận tiền cọc". Trang chi tiết đơn ở admin có hai dòng tiền cọc (kèm lúc cọc) và phần còn lại. Trang đơn của khách đã có từ ticket 04.
- Test: `api/test/preorder-deposit.test.ts` (10 test). Test IPN đổi mã link cọc sang dạng `vnp_TxnRef` bằng `prisma` để dựng trạng thái như cổng thật trả; các test còn lại đi qua `refresh=1`. Toàn bộ bộ test API (45 file, 499 test) qua trên máy; một lần `reconciliation.test.ts` lỗi ở bước `CREATE DATABASE … TEMPLATE` của Docker Desktop, chạy lại thì qua.
