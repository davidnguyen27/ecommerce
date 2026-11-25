# 05: Đổi hàng

**What to build:**
- Khách đổi được sang biến thể khác cùng sản phẩm, cùng giá (ADR 0015).
- Lúc nhân viên chấp nhận, hàng mới được giữ ngay. Kho nhận hàng cũ trước, rồi mới bàn giao hàng mới kèm mã vận đơn.
- Yêu cầu đổi quá 14 ngày chưa nhận được hàng cũ thì bị gắn cờ cho nhân viên thấy.

**Blocked by:** 04

**Status:** resolved

- [x] Migration:
  - `support_request_line` có thêm biến thể đổi sang và số đang giữ;
  - `support_request` có thêm phần giao hàng đổi (đơn vị vận chuyển, mã vận đơn, lúc bàn giao) và lúc gắn cờ quá hạn.
- [x] Tạo yêu cầu `exchange`:
  - như trả hàng (ticket 04: số lượng, hạn đổi trả);
  - biến thể đổi sang phải cùng sản phẩm, khác biến thể khách đang giữ, đang bán, giá bán hiện tại bằng giá của dòng, còn hàng. Không thỏa thì 409 kèm lý do để khách chọn trả hàng.
- [x] Chấp nhận: kiểm lại điều kiện rồi `reserveStock` biến thể mới, thiếu thì 409. Từ chối, hay kết thúc yêu cầu trước khi giao: nhả giữ hàng.
- [x] Nhận hàng cũ dùng hàm của ticket 04.
- [x] Bàn giao hàng đổi (`order.fulfill`):
  - chỉ sau khi đã nhận hàng cũ; trước đó thì 409;
  - `changeStock` loại `sale` (trừ tồn, nhả số giữ), trỏ về đơn và yêu cầu;
  - lưu đơn vị vận chuyển và mã vận đơn; yêu cầu thành `resolved`;
  - email cho khách kèm mã vận đơn.
- [x] Biến thể khách đang giữ của một dòng = biến thể đổi sang của lần đổi gần nhất đã giao, không có thì là biến thể gốc. Trả hay đổi tiếp và nhận hàng về đều dùng biến thể này.
- [x] Job hằng ngày gắn cờ yêu cầu `exchange` đã chấp nhận quá 14 ngày chưa nhận hàng. Không tự hủy. Danh sách admin có bộ lọc cờ này.
- [x] Web:
  - khách: form đổi (chọn dòng, số lượng, biến thể đổi sang; chỉ hiện biến thể đổi được);
  - trang yêu cầu hiện mã vận đơn hàng đổi;
  - admin: khối đổi hàng (chấp nhận, nhận hàng cũ, form bàn giao, cờ quá hạn).
- [x] Test:
  - không gửi được khi biến thể khác giá, khác sản phẩm, ngừng bán hay hết hàng;
  - chấp nhận giữ hàng; giữ không đủ thì 409;
  - bàn giao trước khi nhận hàng cũ thì 409;
  - bàn giao trừ tồn, ghi `sale` trỏ về đơn và yêu cầu;
  - từ chối nhả hàng;
  - job gắn cờ sau 14 ngày;
  - trả tiếp sau khi đổi: nhận về đúng biến thể đã đổi, hoàn theo giá dòng gốc.

Spec: mục "Quy tắc" (đổi hàng), ADR 0015.

**Quyết định khi triển khai (2026-11-18):**
- Migration `20261117001000_support_exchanges`:
  - `support_request_line.held_variant_id` (biến thể khách đang giữ lúc gửi, bắt buộc; dòng cũ điền biến thể gốc), `exchange_variant_id`, `reserved_quantity` (0..số lượng; không có biến thể đổi thì 0; biến thể đổi khác biến thể đang giữ);
  - `support_request.exchange_carrier`, `exchange_tracking_number`, `exchange_handed_over_at` (ba cột đi cùng nhau, chỉ sau khi đã nhận hàng, chỉ cho loại `exchange`), `exchange_overdue_at`.
- Logic ở `api/src/support/exchanges.ts`; `returns.ts` và `support.ts` gọi sang.
- **Biến thể khách đang giữ** ghi vào dòng lúc gửi yêu cầu (`heldVariants`: biến thể đổi sang của lần đổi gần nhất đã giao, không có thì biến thể gốc). Nhận hàng về dùng cột này, không tính lại. Khách vẫn chọn dòng theo biến thể gốc của dòng đơn.
- `returnableQuantities` không tính yêu cầu đổi đã giao hàng mới: khách lại đang giữ đủ số đó nên trả hay đổi tiếp được. Đổi chưa giao vẫn chiếm dòng.
- Tạo yêu cầu `exchange`: như trả hàng (đơn đã giao, số còn trả/đổi được, chụp hạn đổi trả), không có lý do; mỗi dòng có `toVariantId`. `assertExchangeable` kiểm theo thứ tự: cùng sản phẩm → khác biến thể đang giữ → có trong phiên bản đang xuất bản → cùng giá với dòng (giá hiện tại = giá dòng) → tồn − đang giữ ≥ số đổi. Sai thì 409 kèm câu cho khách (khác giá thì gợi ý trả rồi đặt mua mới).
- Chấp nhận (`/decide`): kiểm lại từng dòng rồi `reserveStock`; thiếu thì 409, cả transaction rollback nên không giữ gì và yêu cầu vẫn chờ quyết định.
- Đóng yêu cầu đổi chưa giao (trả lời kèm trạng thái `resolved`/`rejected`): `releaseExchange` nhả số đang giữ. Từ chối ở bước quyết định chưa giữ gì nên không cần nhả.
- Bàn giao (`POST /api/admin/support-requests/:code/exchange-ship`, `order.fulfill`, body đơn vị vận chuyển + mã vận đơn): chỉ sau khi đã nhận hàng cũ (409 nếu chưa), một lần; `changeStock` loại `sale` (−số lượng, nhả số giữ) trỏ về đơn và yêu cầu; yêu cầu `resolved`; tin của cửa hàng và email "đã xong" kèm mã vận đơn; audit `support.exchange_ship`.
- Đổi hàng không có đề xuất hoàn (`returnRefund` chỉ cho trả hàng).
- Job `overdue-exchanges` 7:00 mỗi ngày (giờ Việt Nam): gắn `exchange_overdue_at` cho yêu cầu đổi đã chấp nhận ≥ 14 ngày, chưa nhận hàng, chưa đóng. Gắn một lần, không tự hủy, không nhả hàng. Danh sách admin lọc `exchangeOverdue=true` (đã gắn cờ và chưa nhận hàng).
- Khách xem biến thể đổi được: `GET …/support-requests/exchange-options` (link tra cứu đơn; tài khoản thêm `?orderCode=`). Mỗi dòng: SKU đang giữ, số còn trả/đổi được, các biến thể cùng sản phẩm, cùng giá, đang bán, còn hàng.
- Web:
  - khách: loại "Đổi size hoặc màu" trong form (khi đơn đã giao), chọn dòng, số lượng, biến thể; trang yêu cầu hiện "đổi sang" và mã vận đơn hàng đổi;
  - admin: `AdminSupportReturnPanel` dùng chung cho đổi hàng (cột "Đổi sang", số đang giữ, cờ quá hạn, form bàn giao); bộ lọc "Đổi hàng quá hạn gửi"; nhãn audit.
  - Nhân viên tạo hộ yêu cầu đổi được qua API (`AdminCreateSupportRequest`), trang tạo hộ chưa có form đổi.
- Test `api/test/support-exchanges.test.ts` (8). Test "chỉ còn trả được" của ticket 04 sửa theo câu báo lỗi mới.
- Kết quả: 8 test mới qua; cả bộ test API 689/689. Chưa chạy thử giao diện trên trình duyệt; E2E ở ticket 07.

**Sửa sau review (2026-11-18):**
- **Đổi hàng đổi cả dòng.** Số lượng đổi phải bằng mọi cái khách còn giữ của dòng (`keptQuantities`: số lượng dòng trừ số đã nhận về qua yêu cầu trả), và dòng không được có yêu cầu trả hay đổi nào khác đang chiếm, không thì 409. Nhờ vậy mọi cái khách giữ của một dòng luôn cùng một biến thể, và "biến thể khách đang giữ" tính theo dòng là đúng. Đánh đổi: khách mua 2 cái cùng biến thể không đổi được chỉ 1 cái. `exchange-options` trả `returnable` = số đổi được cả dòng, 0 nếu dòng đang bị chiếm; form hiện số lượng cố định.
- **Không kết thúc yêu cầu đổi đã nhận hàng cũ mà chưa giao hàng mới** (409): phải bàn giao trước. Chỉ nhả hàng giữ khi đóng lúc chưa nhận hàng cũ.
- **Sổ xuất nhập hiện mã yêu cầu** (`StockMovement.supportRequestCode`, link ở trang lịch sử kho). Test kiểm sổ qua `GET /api/admin/stock/movements`, không đọc prisma.
