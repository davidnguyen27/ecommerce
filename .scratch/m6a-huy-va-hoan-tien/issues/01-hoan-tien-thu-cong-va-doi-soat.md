# 01: Hoàn tiền thủ công, giải quyết đối soát bằng hoàn tiền

**What to build:**
- Mô hình hoàn tiền dùng cho cả mốc (ADR 0014), qua lối vào đầu tiên: kế toán giải quyết một mục cần đối soát bằng cách hoàn số tiền đó, rồi ghi lại lần chuyển khoản thủ công.
- Chi tiết đơn ở trang quản trị hiện các số đã nhận, đã hoàn, đang hoàn và danh sách các khoản hoàn.
- Khách nhận email khi khoản hoàn đã xong.

**Blocked by:** —

**Status:** ready-for-agent

- [ ] Migration bảng `refund` theo spec:
  - cột: số tiền, `origin`, `status`, `method`, giao dịch gốc, mã ngân hàng, ngày chuyển, ghi chú, payload cổng, người tạo/thực hiện/chốt, thời điểm;
  - check DB: `method` ↔ không `pending`; `payment_transaction_id` ↔ `vnpay`; `completed_at` ↔ `succeeded`/`failed`;
  - `reconciliation_resolution` thêm `refunded`.
- [ ] Quyền mới `payment.refund` (owner, accountant) và `order.cancel_paid` (owner, sales) trong registry quyền. `order.cancel_paid` khai ở đây để menu và schema shared đủ một lần; ticket 02 mới dùng tới.
- [ ] Hàm tính **số có thể hoàn**: tổng giao dịch của đơn − tổng hoàn tiền không `failed`. Kiểm dưới khóa đơn `FOR UPDATE` ở mọi chỗ tạo hoàn tiền.
- [ ] `POST /api/admin/reconciliation/:id/refund` (`payment.reconcile`): tạo hoàn tiền `pending` (`origin = reconciliation`) bằng số tiền của mục, đóng mục với `refunded`. Mục đã đóng thì 409; vượt số có thể hoàn thì 409. Audit `reconciliation.refund`.
- [ ] `POST /api/admin/refunds/:id/manual` (`payment.refund`): `pending` → `succeeded`, kèm `bankReference`, `transferredOn`, ghi chú tùy chọn. Audit `refund.execute_manual`.
- [ ] `POST /api/admin/refunds/:id/settle` (`payment.refund`): `processing` → `succeeded` hoặc `failed`, ghi chú bắt buộc. Audit `refund.settle`.
- [ ] `POST /api/admin/refunds/:id/retry` (`payment.refund`): từ `failed`, tạo hoàn tiền `pending` mới (`origin = retry`), số tiền ≤ số của khoản thất bại và ≤ số có thể hoàn. Audit `refund.retry`.
- [ ] Email "Đã hoàn tiền" (mã đơn, số tiền, ngày), gửi khi một hoàn tiền chuyển sang `succeeded`. Nội dung tạm.
- [ ] Chi tiết đơn ở trang quản trị trả `received`, `refunded`, `refunding` và danh sách hoàn tiền. Danh sách đơn có bộ lọc `refund=open`.
- [ ] Web admin:
  - nút "Hoàn tiền" ở trang đối soát;
  - khối "Hoàn tiền" ở chi tiết đơn, có nút "Ghi chuyển khoản", "Đánh dấu đã hoàn/thất bại", "Tạo lại" theo quyền;
  - bộ lọc "Hoàn tiền chưa xong" ở danh sách đơn.
- [ ] Test qua HTTP:
  - giải quyết đối soát bằng hoàn tiền: đúng số tiền, mục đóng, mục đã đóng thì 409;
  - thủ công `pending` → `succeeded`, có email;
  - chốt `processing` (dựng trạng thái bằng prisma);
  - tạo lại từ `failed`, vượt giới hạn thì 400/409;
  - hai yêu cầu song song không làm tổng vượt đã nhận;
  - sales và warehouse bị 403;
  - audit có trước và sau.

Spec: mục "Hoàn tiền (ADR 0014)", "Đối soát", "Quyền", "API quản trị", "Email", "Web".
