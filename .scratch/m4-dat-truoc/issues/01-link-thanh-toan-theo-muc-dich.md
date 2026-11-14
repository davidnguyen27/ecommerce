# 01: Link thanh toán theo mục đích

**What to build:**
- Một đơn tạo được nhiều link thanh toán, mỗi link có một mục đích (`full`, `deposit`, `remainder`). Đây là chuẩn bị cho đơn đặt trước (cọc rồi trả phần còn lại). Với đơn hàng sẵn của M3, hành vi khách thấy không đổi.

**Blocked by:** —

**Status:** ready-for-agent

- [ ] Bảng link thanh toán: đơn, mục đích, số tiền, mã đơn bên cổng (duy nhất), thời điểm tạo, hạn. Migration chuyển `order.gateway_reference` cũ sang bảng này với mục đích `full`, sau đó bỏ cột cũ
- [ ] Giao dịch thanh toán có cột mục đích, lấy theo link mà giao dịch thuộc về. Giao dịch cũ có mục đích `full`. Bảng vẫn chỉ ghi thêm (trigger giữ nguyên)
- [ ] IPN, `return`, `refresh=1` và job hết hạn tìm đơn và truy vấn cổng qua bảng link. Đơn có nhiều link thì duyệt mọi link của đơn
- [ ] Đặt mua M3 tạo link `full`. Ghi nhận thanh toán M3 chỉ coi giao dịch `full` là trả đủ
- [ ] Toàn bộ test M3 (thanh toán, hết hạn, đối soát) vẫn qua, không sửa kỳ vọng
- [ ] Test thêm: đơn tạo trước migration vẫn `refresh=1` và hết hạn đúng (dựng bằng SQL); mã đơn bên cổng trùng giữa hai link bị chặn

Spec: `.scratch/m4-dat-truoc/spec.md` mục "Thanh toán".
