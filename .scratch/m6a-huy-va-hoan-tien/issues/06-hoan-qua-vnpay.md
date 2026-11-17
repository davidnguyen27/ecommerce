# 06: Hoàn qua VNPAY và cổng giả lập

**What to build:**
- Kế toán thực hiện một khoản hoàn bằng lệnh `refund` của VNPAY thay vì chuyển khoản tay. Hệ thống chia số tiền theo các giao dịch VNPAY của đơn, lấy giao dịch mới nhất trước, và ghi kết quả: đã hoàn, đang xử lý (chốt tay sau), hoặc thất bại.
- Ở local và trên bản demo, cổng giả lập trả về đủ ba kết quả.

**Blocked by:** 01

**Status:** resolved

- [x] Kiểm trước, rồi ghi vào phần quyết định của ticket và vào ADR 0014 nếu ảnh hưởng mô hình:
  - thuật toán hash của lệnh `refund` (trang đổi thuật toán của VNPAY);
  - endpoint production;
  - hạn được hoàn;
  - có được hoàn một phần nhiều lần trên một giao dịch không;
  - sandbox có chạy lệnh `refund` không.

  Sandbox không chạy được thì giữ adapter, test bằng unit test, và ghi rõ là chưa thử được với cổng thật.
- [x] `PaymentGateway.refund(...)` trả `succeeded | processing | rejected` kèm payload.
  - `InMemoryPaymentGateway`: test đặt trước kết quả.
  - `SimulatorPaymentGateway`: chữ số cuối của số tiền `1` → `processing`, `2` → `rejected`, còn lại → `succeeded`.
- [x] Adapter VNPAY:
  - dựng request theo tài liệu `querydr&refund` (`vnp_TransactionType` `02`/`03`, `vnp_TxnRef`, `vnp_TransactionNo`, `vnp_TransactionDate` từ payload giao dịch gốc, `vnp_CreateBy` là id nhân viên);
  - ký theo thứ tự trường của tài liệu; kiểm chữ ký phản hồi;
  - ánh xạ: `00`+`00` → `succeeded`; `00`+`05`/`06` hoặc `94` → `processing`; còn lại → `rejected`.
- [x] `POST /api/admin/refunds/:id/vnpay` (`payment.refund`), dưới khóa đơn `FOR UPDATE`:
  - chia số tiền theo giao dịch có nguồn từ cổng (không phải giao dịch nhập tay), giao dịch mới nhất trước, mỗi giao dịch tới phần chưa hoàn của nó;
  - cần nhiều giao dịch thì tách hoàn tiền thành nhiều bản ghi `pending` trong cùng transaction, trước khi gọi cổng;
  - gọi cổng **sau** commit, mỗi bản ghi một lần;
  - ghi kết quả và payload; `succeeded` thì gửi email "Đã hoàn tiền".

  Audit `refund.execute_vnpay`. Lỗi mạng hay 5xx của cổng thì bản ghi ở `processing` kèm lý do, để kế toán kiểm và chốt tay.
- [x] Web admin: nút "Hoàn qua VNPAY" trong khối "Hoàn tiền", ẩn khi đơn không có giao dịch hoàn được qua cổng. Hiện kết quả ngay sau khi gọi.
- [x] Test:
  - unit test chữ ký và ánh xạ mã phản hồi của adapter;
  - qua HTTP với cổng giả: ba kết quả;
  - đơn đặt trước có hai giao dịch được chia đúng, mới nhất trước;
  - không hoàn vượt phần chưa hoàn của một giao dịch;
  - đơn chỉ có giao dịch không hoàn qua cổng được thì 409;
  - thiếu `payment.refund` thì 403.

Spec: mục "Hoàn tiền (ADR 0014)" (thực hiện qua VNPAY), ADR 0010.

**Quyết định khi triển khai (2026-11-17):**
- **Kết quả kiểm sandbox** (đã ghi vào ADR 0014):
  - Gọi `refund` thật tới VNPAY sandbox bằng khóa sandbox trong `.env`, với giao dịch gốc không có thật (mã đơn 999999, 10.000 VND), nên không đụng tới tiền.
  - Hoàn đủ và hoàn một phần đều trả `99 Unexpected error`. Ký bằng khóa cố tình sai cũng ra `99`. Như vậy sandbox không xử lý lệnh này, giống `querydr` ở ADR 0010, và chữ ký chưa xác minh được.
  - Trang tài liệu "Chuyển đổi thuật toán" ghi phiên bản 2.1.0 dùng HMAC-SHA512. Trang `querydr&refund` chỉ ghi `hashWithSecureType`; không ghi hạn được hoàn, không giới hạn số lần hoàn một phần.
  - Endpoint production vẫn là bản suy đoán có sẵn trong `VNPAY_HOSTS`.
- `PaymentGateway` có thêm hai hàm:
  - `canRefund(transaction)`:
    - VNPAY: giao dịch không phải nguồn `simulator` và payload có `vnp_TxnRef` hợp lệ;
    - cổng giả lập: chỉ giao dịch nguồn `simulator`;
    - cổng trong bộ nhớ: theo cờ `allowRefund`;
  - `refund(request)`, trả `succeeded | processing | rejected` kèm `message`, `payload`.
- Adapter VNPAY:
  - `vnp_RequestId` là id khoản hoàn bỏ gạch (32 ký tự). `vnp_CreateBy` là id nhân viên bỏ gạch, không dùng email;
  - `vnp_TransactionDate` lấy từ `vnp_TxnRef` của giao dịch gốc;
  - loại `02` khi giao dịch chưa từng hoàn qua cổng và số tiền bằng giao dịch, còn lại `03`;
  - response `00` phải đúng chữ ký; mã lỗi thì không kiểm chữ ký;
  - ánh xạ kết quả ở `refundOutcome`.
- Cổng giả lập: chữ số cuối của số tiền là `1` thì đang xử lý, `2` thì bị từ chối, còn lại thì đã hoàn.
- `api/src/payments/gateway-refund.ts`, hàm `executeGatewayRefund`, ba bước:
  1. Trong `audited()` dưới khóa đơn:
     - chia số tiền theo các giao dịch hoàn được, mới nhất trước, mỗi giao dịch tới phần chưa hoàn qua cổng;
     - không đủ thì 409 ("hãy hoàn bằng chuyển khoản");
     - cần nhiều giao dịch thì tách khoản thành nhiều khoản. Chỉ khoản sinh từ hủy đơn mới tách được; khoản từ đối soát hay tạo lại trỏ về đúng một mục (unique), nên trả 409;
     - mọi phần sang `processing` (`method = vnpay`). Audit `refund.execute_vnpay`.
  2. Gọi cổng sau khi commit. Cổng lỗi (`PaymentGatewayError`, mạng, HTTP) thì phần đó ở `processing` kèm lý do trong ghi chú, để kế toán kiểm và chốt tay. Lệnh không bị gửi lại.
  3. Trong `audited()` mới: ghi kết quả từng phần.
     - đã hoàn: sự kiện và email "Đã hoàn tiền";
     - bị từ chối: thành thất bại, ghi lý do, tạo lại được;
     - audit `refund.gateway_result`.
- `method = vnpay` nghĩa là "hoàn qua cổng". Ở local và trên bản demo, cổng đó là cổng giả lập.
- `AdminPaymentTransaction.gatewayRefundable` và `AdminOrder.gatewayRefundable`: phần các giao dịch còn hoàn qua cổng được.
  - Số này không trừ khoản đang chờ hoàn, vì chính khoản đó sẽ đi qua cổng.
  - Web hiện nút "Hoàn qua VNPAY" khi số này ≥ số tiền của khoản chờ hoàn.
  - Để tính được, `loadAdminOrder` nhận thêm cổng thanh toán; `adminReconciliationRoutes` và `adminRefundRoutes` cũng nhận cổng.
- Web: nút "Hoàn qua VNPAY" (có `confirm`) trong khối "Hoàn tiền". Kết quả hiện ngay ở trạng thái và ghi chú của khoản. Nhãn audit cho hai action mới.
- Test:
  - `api/test/vnpay-refund.test.ts` (6 unit test): trường gửi đi, chữ ký, `02`/`03`, ánh xạ mã, response sai chữ ký, HTTP/mạng lỗi, `canRefund`;
  - `api/test/refund-gateway.test.ts` (9 test qua HTTP): ba kết quả của cổng, cổng không trả lời, không có giao dịch hoàn được, 403/404/409, đơn đặt trước chia làm hai khoản (phần còn lại trước, rồi tới cọc), cổng giả lập.
- Chưa chạy thử giao diện trên trình duyệt; E2E ở ticket 07.
