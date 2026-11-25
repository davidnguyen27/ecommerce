# 04: Trả hàng và hạn đổi trả

**What to build:**
- Khách đã nhận hàng gửi yêu cầu trả một phần hay toàn bộ, kèm lý do và ảnh.
- Nhân viên chấp nhận hoặc từ chối. Kho nhận hàng về: nhập lại tồn hoặc ghi hỏng. Nhân viên đề xuất hoàn; kế toán hoàn tiền như M6a.
- Nhân viên thấy yêu cầu đã quá hạn đổi trả của nhóm hàng bao nhiêu ngày. Chủ doanh nghiệp đặt số ngày đó.

**Blocked by:** 01

**Status:** resolved

- [x] Migration:
  - bảng `support_request_line`;
  - các cột quyết định (chấp nhận/từ chối, người, lúc) và lúc nhận hàng trên `support_request`;
  - bảng `return_window`;
  - `stock_movement.support_request_id`;
  - `refund_origin` thêm `return` cùng `refund.support_request_id`, sửa `refund_origin_check` (so theo text).
- [x] Hạn đổi trả:
  - `GET`/`PUT /api/admin/return-windows` (`content.edit`, audit);
  - khi gửi yêu cầu trả hay đổi, chụp số ngày (nhỏ nhất trong các nhóm hàng của các dòng), ngày giao (sự kiện `delivered`) và số ngày đã quá.
- [x] Tạo yêu cầu `return`:
  - đơn `completed`;
  - các dòng có số lượng ≥ 1 và lý do;
  - dưới khóa đơn: tổng số các yêu cầu trả/đổi chưa bị từ chối trên mỗi dòng không vượt số lượng dòng trừ số đã nhận về ở các lần trả trước. Vượt thì 409.
- [x] Chấp nhận/từ chối (`support.handle`): kèm tin cho khách, gửi email. Từ chối thì yêu cầu `rejected`.
- [x] Nhận hàng về (`order.fulfill`), một hàm dùng chung cho đổi hàng ở ticket 05:
  - mỗi dòng: nhập lại tồn + ghi hỏng = số lượng yêu cầu;
  - biến thể thực nhận là biến thể khách đang giữ của dòng;
  - phần nhập lại qua `changeStock` loại `return`, trỏ về đơn và yêu cầu.
- [x] Đề xuất hoàn (`support.handle`):
  - mặc định Σ(giá × số trả − phần giảm của dòng × số trả / số lượng dòng, làm tròn xuống tới đồng), không gồm phí giao;
  - thấp hơn thì ghi chú bắt buộc;
  - `createRefund` với `origin = return`. Hoàn 0 thì không tạo khoản;
  - yêu cầu thành `resolved`.

  Đơn giữ `completed`, lượt mã không đổi.
- [x] Web:
  - khách: form trả hàng (chọn dòng, số lượng, lý do), trạng thái và khoản hoàn ở trang yêu cầu;
  - admin: khối trả hàng (cảnh báo quá hạn, chấp nhận/từ chối, form nhận hàng về theo dòng, form đề xuất hoàn), trang "Hạn đổi trả".
- [x] Test:
  - không gửi được khi đơn chưa giao hay số lượng vượt (kể cả hai yêu cầu song song);
  - chụp hạn đổi trả đúng;
  - nhận về ghi `return` đúng biến thể, đơn và yêu cầu;
  - hoàn mặc định trừ phần giảm, không gồm phí giao, `origin = return`;
  - đơn vẫn `completed`, lượt mã không đổi;
  - quyền từng bước (sales không nhận hàng về; kho không đề xuất hoàn).

Spec: mục "Mô hình", "Quy tắc" (trả hàng, hạn đổi trả).

**Quyết định khi triển khai (2026-11-17):**
- Migration `20261117000900_support_returns`:
  - enum `support_return_reason`, `support_decision`; `refund_origin.return`;
  - bảng `support_request_line` (dòng đơn, số lượng, lý do, số nhập lại, số hỏng, biến thể kho thực nhận; mỗi yêu cầu một dòng cho mỗi dòng đơn);
  - bảng `return_window` (nhóm hàng → số ngày 0–365);
  - các cột quyết định, nhận hàng, hạn đổi trả trên `support_request`, kèm `support_request_decision_check` (chỉ nhận hàng sau khi chấp nhận);
  - `stock_movement.support_request_id` (chỉ với `sale`/`return`) và `refund.support_request_id`;
  - `refund_origin_check` có thêm `return` ↔ có yêu cầu, so theo text.
- Logic trả hàng ở `api/src/support/returns.ts`, tách khỏi `support.ts`. Hai module import lẫn nhau, nhưng chỉ dùng hàm lúc chạy nên không vướng thứ tự nạp.
- **Số còn trả được** của một dòng đơn (`returnableQuantities`, dưới khóa đơn) = số lượng dòng − tổng số lượng các yêu cầu trả/đổi chưa bị từ chối. Yêu cầu bị đóng (`resolved`) mà chưa nhận hàng thì không tính, để nhân viên lỡ đóng tay cũng không khóa số lượng mãi. Ticket 05 sẽ chỉnh hàm này cho hàng đã đổi.
- Tạo yêu cầu `return`:
  - đơn `completed` + `delivered`;
  - khách chọn dòng theo `variantId` (mỗi đơn một dòng cho mỗi biến thể);
  - sản phẩm không có trong đơn thì 400; vượt số còn trả được thì 409.
- `CreateSupportRequest` và `AdminCreateSupportRequest` thành union theo `kind`: `other`, `cancel`, `return` (có `lines`). Nhân viên tạo hộ được cả yêu cầu trả.
- Hạn đổi trả chụp lúc gửi:
  - số ngày nhỏ nhất trong các nhóm hàng của các dòng; nhóm không cấu hình thì bỏ qua, không nhóm nào thì `null`;
  - lúc giao lấy từ sự kiện đơn `delivered` gần nhất;
  - số ngày đã quá = max(0, số ngày từ lúc giao (làm tròn xuống) − hạn).
- Chấp nhận/từ chối (`/decide`, `support.handle`):
  - lời nhắn cho khách bắt buộc;
  - chấp nhận thì `in_progress` và email "đã được chấp nhận" kèm lời nhắn; từ chối thì `rejected` và email kèm lý do;
  - người quyết định tự thành người phụ trách nếu chưa ai nhận;
  - dùng chung cho đổi hàng và bảo hành; loại `other`/`cancel` thì 409.
- Nhận hàng về (`/receive`, `order.fulfill`):
  - mỗi dòng của yêu cầu đúng một mục, nhập lại + hỏng = số lượng (400 nếu sai);
  - phần nhập lại qua `changeStock` loại `return`, trỏ về đơn và yêu cầu; phần hỏng không ghi sổ;
  - ghi biến thể thực nhận và một tin hệ thống "Cửa hàng đã nhận hàng bạn gửi về".
- Đề xuất hoàn (`/refund`, `support.handle`):
  - khóa đơn trước rồi mới khóa yêu cầu, cùng thứ tự với hủy đơn;
  - gợi ý = Σ(giá × số trả − phần giảm của dòng × số trả / số lượng dòng, làm tròn xuống), không gồm phí giao;
  - số hoàn > còn hoàn được của đơn thì 400; thấp hơn gợi ý mà thiếu ghi chú thì 400;
  - hoàn > 0 thì `createRefund` với `origin = return`, gắn yêu cầu;
  - yêu cầu `resolved`, email kèm số tiền (hoặc câu "không được hoàn tiền").
- `AdminSupportRequest` có thêm:
  - các dòng: biến thể khách đang giữ, số nhập lại/hỏng;
  - quyết định, nhận hàng;
  - `returnWindow`;
  - `returnRefund` (gợi ý và còn hoàn được, chỉ khi đã nhận hàng mà chưa đóng; route điền vì cần đọc DB);
  - các khoản hoàn của yêu cầu.

  `PublicSupportRequest` có thêm các dòng, quyết định và lúc nhận hàng.
- Hạn đổi trả: `GET`/`PUT /api/admin/return-windows`. Xem được với `content.edit`, `support.handle` hoặc `order.view`; sửa với `content.edit`. `null` là bỏ cấu hình. Không đổi gì thì không ghi audit; audit `return_window.update` dùng id cố định như phí giao.
- Web:
  - khách: form gửi yêu cầu có loại "Trả hàng" khi đơn đã giao (chọn dòng, số lượng, lý do); trang yêu cầu hiện các dòng, đã chấp nhận, đã nhận hàng;
  - admin: `AdminSupportReturnPanel` (hạn đổi trả, chấp nhận/từ chối, nhận hàng về theo dòng, đề xuất hoàn); trang `/admin/return-windows` và mục menu; nhãn audit mới.
- Test `api/test/support-returns.test.ts`.
- Test "quá hạn đổi trả" gọi thẳng `returnWindowSnapshot` với "bây giờ" dời về sau, vì bảng sự kiện đơn chỉ ghi thêm nên không lùi được lúc giao.
- Kết quả: 11 test mới qua; cả bộ test API 681/681. Chưa chạy thử giao diện trên trình duyệt; E2E ở ticket 07.

**Bổ sung sau review (2026-11-18):**
- `PublicSupportRequest.refunds`: khách thấy khoản hoàn của yêu cầu ngay ở trang yêu cầu (đang hoàn hay đã hoàn), cùng cách hiển thị với trang đơn (`toPublicRefunds` dùng chung). `PublicRefund` chuyển sang `shared/src/refunds.ts` để `support.ts` và `orders.ts` không import vòng.
- Danh sách admin có bộ lọc `returnOverdue=true` (yêu cầu gửi khi đã quá hạn đổi trả, `overdueDays > 0`).

**Sửa sau review (2026-11-18):**
- **Hàng đã nhận về luôn chiếm số lượng của dòng**, dù yêu cầu kết thúc thế nào. `returnableQuantities` chỉ bỏ qua yêu cầu đã kết thúc mà chưa nhận hàng. Yêu cầu đã nhận hàng thì không chuyển sang `rejected` được (409), chỉ kết thúc bằng `resolved`.
- **Khoản hoàn tạo lại giữ yêu cầu trả.** Migration `20261117001200_refund_retry_support` cho `origin = retry` mang `support_request_id`; `retryRefund` chép từ khoản thất bại. Yêu cầu và khách vẫn thấy khoản mới.
