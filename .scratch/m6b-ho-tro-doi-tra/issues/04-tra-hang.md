# 04: Trả hàng và hạn đổi trả

**What to build:**
- Khách đã nhận hàng gửi yêu cầu trả một phần hay toàn bộ, kèm lý do và ảnh.
- Nhân viên chấp nhận hoặc từ chối. Kho nhận hàng về: nhập lại tồn hoặc ghi hỏng. Nhân viên đề xuất hoàn; kế toán hoàn tiền như M6a.
- Nhân viên thấy yêu cầu đã quá hạn đổi trả của nhóm hàng bao nhiêu ngày. Chủ doanh nghiệp đặt số ngày đó.

**Blocked by:** 01

**Status:** ready-for-agent

- [ ] Migration:
  - bảng `support_request_line`;
  - các cột quyết định (chấp nhận/từ chối, người, lúc) và lúc nhận hàng trên `support_request`;
  - bảng `return_window`;
  - `stock_movement.support_request_id`;
  - `refund_origin` thêm `return` cùng `refund.support_request_id`, sửa `refund_origin_check` (so theo text).
- [ ] Hạn đổi trả:
  - `GET`/`PUT /api/admin/return-windows` (`content.edit`, audit);
  - khi gửi yêu cầu trả hay đổi, chụp số ngày (nhỏ nhất trong các nhóm hàng của các dòng), ngày giao (sự kiện `delivered`) và số ngày đã quá.
- [ ] Tạo yêu cầu `return`:
  - đơn `completed`;
  - các dòng có số lượng ≥ 1 và lý do;
  - dưới khóa đơn: tổng số các yêu cầu trả/đổi chưa bị từ chối trên mỗi dòng không vượt số lượng dòng trừ số đã nhận về ở các lần trả trước. Vượt thì 409.
- [ ] Chấp nhận/từ chối (`support.handle`): kèm tin cho khách, gửi email. Từ chối thì yêu cầu `rejected`.
- [ ] Nhận hàng về (`order.fulfill`), một hàm dùng chung cho đổi hàng ở ticket 05:
  - mỗi dòng: nhập lại tồn + ghi hỏng = số lượng yêu cầu;
  - biến thể thực nhận là biến thể khách đang giữ của dòng;
  - phần nhập lại qua `changeStock` loại `return`, trỏ về đơn và yêu cầu.
- [ ] Đề xuất hoàn (`support.handle`):
  - mặc định Σ(giá × số trả − phần giảm của dòng × số trả / số lượng dòng, làm tròn xuống tới đồng), không gồm phí giao;
  - thấp hơn thì ghi chú bắt buộc;
  - `createRefund` với `origin = return`. Hoàn 0 thì không tạo khoản;
  - yêu cầu thành `resolved`.

  Đơn giữ `completed`, lượt mã không đổi.
- [ ] Web:
  - khách: form trả hàng (chọn dòng, số lượng, lý do), trạng thái và khoản hoàn ở trang yêu cầu;
  - admin: khối trả hàng (cảnh báo quá hạn, chấp nhận/từ chối, form nhận hàng về theo dòng, form đề xuất hoàn), trang "Hạn đổi trả".
- [ ] Test:
  - không gửi được khi đơn chưa giao hay số lượng vượt (kể cả hai yêu cầu song song);
  - chụp hạn đổi trả đúng;
  - nhận về ghi `return` đúng biến thể, đơn và yêu cầu;
  - hoàn mặc định trừ phần giảm, không gồm phí giao, `origin = return`;
  - đơn vẫn `completed`, lượt mã không đổi;
  - quyền từng bước (sales không nhận hàng về; kho không đề xuất hoàn).

Spec: mục "Mô hình", "Quy tắc" (trả hàng, hạn đổi trả).
