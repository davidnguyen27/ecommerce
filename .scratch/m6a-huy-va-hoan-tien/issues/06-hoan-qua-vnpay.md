# 06: Hoàn qua VNPAY và cổng giả lập

**What to build:**
- Kế toán thực hiện một khoản hoàn bằng lệnh `refund` của VNPAY thay vì chuyển khoản tay. Hệ thống chia số tiền theo các giao dịch VNPAY của đơn, lấy giao dịch mới nhất trước, và ghi kết quả: đã hoàn, đang xử lý (chốt tay sau), hoặc thất bại.
- Ở local và trên bản demo, cổng giả lập trả về đủ ba kết quả.

**Blocked by:** 01

**Status:** ready-for-agent

- [ ] Kiểm trước, rồi ghi vào phần quyết định của ticket và vào ADR 0014 nếu ảnh hưởng mô hình:
  - thuật toán hash của lệnh `refund` (trang đổi thuật toán của VNPAY);
  - endpoint production;
  - hạn được hoàn;
  - có được hoàn một phần nhiều lần trên một giao dịch không;
  - sandbox có chạy lệnh `refund` không.

  Sandbox không chạy được thì giữ adapter, test bằng unit test, và ghi rõ là chưa thử được với cổng thật.
- [ ] `PaymentGateway.refund(...)` trả `succeeded | processing | rejected` kèm payload.
  - `InMemoryPaymentGateway`: test đặt trước kết quả.
  - `SimulatorPaymentGateway`: chữ số cuối của số tiền `1` → `processing`, `2` → `rejected`, còn lại → `succeeded`.
- [ ] Adapter VNPAY:
  - dựng request theo tài liệu `querydr&refund` (`vnp_TransactionType` `02`/`03`, `vnp_TxnRef`, `vnp_TransactionNo`, `vnp_TransactionDate` từ payload giao dịch gốc, `vnp_CreateBy` là id nhân viên);
  - ký theo thứ tự trường của tài liệu; kiểm chữ ký phản hồi;
  - ánh xạ: `00`+`00` → `succeeded`; `00`+`05`/`06` hoặc `94` → `processing`; còn lại → `rejected`.
- [ ] `POST /api/admin/refunds/:id/vnpay` (`payment.refund`), dưới khóa đơn `FOR UPDATE`:
  - chia số tiền theo giao dịch có nguồn từ cổng (không phải giao dịch nhập tay), giao dịch mới nhất trước, mỗi giao dịch tới phần chưa hoàn của nó;
  - cần nhiều giao dịch thì tách hoàn tiền thành nhiều bản ghi `pending` trong cùng transaction, trước khi gọi cổng;
  - gọi cổng **sau** commit, mỗi bản ghi một lần;
  - ghi kết quả và payload; `succeeded` thì gửi email "Đã hoàn tiền".

  Audit `refund.execute_vnpay`. Lỗi mạng hay 5xx của cổng thì bản ghi ở `processing` kèm lý do, để kế toán kiểm và chốt tay.
- [ ] Web admin: nút "Hoàn qua VNPAY" trong khối "Hoàn tiền", ẩn khi đơn không có giao dịch hoàn được qua cổng. Hiện kết quả ngay sau khi gọi.
- [ ] Test:
  - unit test chữ ký và ánh xạ mã phản hồi của adapter;
  - qua HTTP với cổng giả: ba kết quả;
  - đơn đặt trước có hai giao dịch được chia đúng, mới nhất trước;
  - không hoàn vượt phần chưa hoàn của một giao dịch;
  - đơn chỉ có giao dịch không hoàn qua cổng được thì 409;
  - thiếu `payment.refund` thì 403.

Spec: mục "Hoàn tiền (ADR 0014)" (thực hiện qua VNPAY), ADR 0010.
