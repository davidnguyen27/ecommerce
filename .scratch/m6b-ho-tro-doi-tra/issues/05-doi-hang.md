# 05: Đổi hàng

**What to build:**
- Khách đổi được sang biến thể khác cùng sản phẩm, cùng giá (ADR 0015).
- Lúc nhân viên chấp nhận, hàng mới được giữ ngay. Kho nhận hàng cũ trước, rồi mới bàn giao hàng mới kèm mã vận đơn.
- Yêu cầu đổi quá 14 ngày chưa nhận được hàng cũ thì bị gắn cờ cho nhân viên thấy.

**Blocked by:** 04

**Status:** ready-for-agent

- [ ] Migration:
  - `support_request_line` có thêm biến thể đổi sang và số đang giữ;
  - `support_request` có thêm phần giao hàng đổi (đơn vị vận chuyển, mã vận đơn, lúc bàn giao) và lúc gắn cờ quá hạn.
- [ ] Tạo yêu cầu `exchange`:
  - như trả hàng (ticket 04: số lượng, hạn đổi trả);
  - biến thể đổi sang phải cùng sản phẩm, khác biến thể khách đang giữ, đang bán, giá bán hiện tại bằng giá của dòng, còn hàng. Không thỏa thì 409 kèm lý do để khách chọn trả hàng.
- [ ] Chấp nhận: kiểm lại điều kiện rồi `reserveStock` biến thể mới, thiếu thì 409. Từ chối, hay kết thúc yêu cầu trước khi giao: nhả giữ hàng.
- [ ] Nhận hàng cũ dùng hàm của ticket 04.
- [ ] Bàn giao hàng đổi (`order.fulfill`):
  - chỉ sau khi đã nhận hàng cũ; trước đó thì 409;
  - `changeStock` loại `sale` (trừ tồn, nhả số giữ), trỏ về đơn và yêu cầu;
  - lưu đơn vị vận chuyển và mã vận đơn; yêu cầu thành `resolved`;
  - email cho khách kèm mã vận đơn.
- [ ] Biến thể khách đang giữ của một dòng = biến thể đổi sang của lần đổi gần nhất đã giao, không có thì là biến thể gốc. Trả hay đổi tiếp và nhận hàng về đều dùng biến thể này.
- [ ] Job hằng ngày gắn cờ yêu cầu `exchange` đã chấp nhận quá 14 ngày chưa nhận hàng. Không tự hủy. Danh sách admin có bộ lọc cờ này.
- [ ] Web:
  - khách: form đổi (chọn dòng, số lượng, biến thể đổi sang; chỉ hiện biến thể đổi được);
  - trang yêu cầu hiện mã vận đơn hàng đổi;
  - admin: khối đổi hàng (chấp nhận, nhận hàng cũ, form bàn giao, cờ quá hạn).
- [ ] Test:
  - không gửi được khi biến thể khác giá, khác sản phẩm, ngừng bán hay hết hàng;
  - chấp nhận giữ hàng; giữ không đủ thì 409;
  - bàn giao trước khi nhận hàng cũ thì 409;
  - bàn giao trừ tồn, ghi `sale` trỏ về đơn và yêu cầu;
  - từ chối nhả hàng;
  - job gắn cờ sau 14 ngày;
  - trả tiếp sau khi đổi: nhận về đúng biến thể đã đổi, hoàn theo giá dòng gốc.

Spec: mục "Quy tắc" (đổi hàng), ADR 0015.
