# 03: Đặt mua và giữ hàng

**What to build:**
- Khách đặt mua từ giỏ: nhập thông tin nhận hàng, thấy phí giao và tổng, rồi xác nhận. Hệ thống kiểm lại giá và tồn, tạo đơn, giữ hàng 15 phút, rồi chuyển khách tới trang thanh toán (cổng giả lập khi chạy local).
- Kho có thêm giữ hàng (ADR 0007):
  - "còn hàng" ở mọi chỗ đổi sang tồn trừ số đang giữ;
  - trang Tồn kho có cột "Đang giữ";
  - điều chỉnh tồn xuống dưới số đang giữ bị chặn.
- Khách xem đơn qua link có token, không cần đăng nhập.

Ticket này gộp phần giữ hàng ở kho vào đặt mua, để giữ hàng có đơn thật ngay từ đầu. Đồng ý chính sách bảo mật, thông tin hóa đơn và giới hạn tần suất làm ở ticket 04.

**Blocked by:** 02 (Giỏ hàng)

**Status:** ready-for-agent

Kho:
- [ ] Biến thể có cột `reserved INTEGER NOT NULL DEFAULT 0`, kèm check `reserved >= 0` và `reserved <= on_hand`
- [ ] Module kho có hàm giữ và hàm nhả giữ hàng. Cả hai dùng chung đường khóa với `changeStock`: khóa `FOR UPDATE` theo thứ tự id.
  - Giữ: kiểm `on_hand - reserved >= số lượng` cho từng dòng. Thiếu ở bất kỳ dòng nào thì không giữ dòng nào và trả lỗi theo dòng.
  - Nhả: trừ `reserved`, không ghi sổ xuất nhập.
- [ ] "Còn hàng" tính theo `on_hand - reserved > 0` ở mọi chỗ: `inStockIds`, tìm kiếm, sắp xếp còn hàng trước, `availability` của JSON-LD. Cập nhật mục "Snapshot đã xuất bản" trong `CODING_STANDARDS.md` cho khớp ADR 0007
- [ ] Trang Tồn kho và API của trang có cột "Đang giữ"
- [ ] Điều chỉnh tồn làm `on_hand` mới nhỏ hơn `reserved` thì trả 409, kèm danh sách mã đơn đang giữ biến thể đó. Phiếu nhập không bị ảnh hưởng

Đơn hàng:
- [ ] Bảng đơn hàng gồm:
  - id uuid;
  - mã đơn lấy từ sequence riêng, bắt đầu từ 100000;
  - ba trạng thái (đơn hàng, thanh toán, giao hàng) theo spec;
  - snapshot thông tin nhận hàng;
  - phí giao, tổng tiền hàng, tổng phải trả, ghi chú;
  - id các phiên bản chính sách đổi trả/bảo hành gắn với sản phẩm trong đơn;
  - `customer_id` khi khách đã đăng nhập;
  - hash của token tra cứu;
  - thời điểm hết hạn giữ hàng.
- [ ] Bảng dòng đơn lưu snapshot: variant id, SKU, tên sản phẩm, thuộc tính biến thể, ảnh đại diện, giá bán, số lượng
- [ ] Bảng sự kiện đơn chỉ ghi thêm, trigger chặn sửa và xóa. Mỗi sự kiện có: đơn, loại sự kiện, actor (nhân viên, khách hoặc hệ thống), thời điểm, dữ liệu. Ticket này ghi sự kiện "tạo đơn"
- [ ] Interface cổng thanh toán (tạo link, truy vấn theo mã đơn, hủy link), inject vào `createApp` như `Storage` và `EmailQueue`. Có ba bản:
  - Bản giả trong bộ nhớ cho test: ghi lại link đã tạo và đã hủy, trả trạng thái do test đặt, giả lập được lỗi khi tạo link.
  - Cổng giả lập cho local: một trang trên web hiện số tiền và mã đơn. Hai nút giả lập để trống; ticket 05 và 06 sẽ nối vào.
- [ ] `POST /api/checkout` chạy trong một transaction:
  1. Kiểm từng dòng: sản phẩm đã xuất bản, biến thể có trong phiên bản đang xuất bản, không ngừng bán, giá bằng giá khách đã thấy, số lượng 1–5.
  2. Có dòng sai thì 409 kèm `details` theo dòng, không ghi gì.
  3. Tính phí giao, tạo đơn, giữ hàng. Thiếu hàng cũng trả 409 theo dòng.
  4. Tạo link thanh toán, thời hạn bằng thời hạn giữ hàng.

  Response trả mã đơn, token tra cứu (chỉ có trong response này), `checkoutUrl` và thời điểm hết hạn.
- [ ] Cổng lỗi khi tạo link thì rollback toàn bộ (không có đơn, không giữ hàng) và trả 502 "Chưa tạo được thanh toán, thử lại"
- [ ] Chưa cấu hình phí giao mặc định thì trả 503, giống `quote`
- [ ] `GET /api/orders/:code?token=…`: token sai hoặc thiếu thì 404, để không lộ đơn có tồn tại hay không
- [ ] Web, trang đặt mua:
  - chọn tỉnh/thành và phường/xã, nhập số nhà/đường, tên, số điện thoại, email, ghi chú;
  - gọi `quote` khi mở trang và khi đổi tỉnh/thành;
  - hiện lưu ý khi có món chỉ giao đường bộ;
  - gặp 409 thì hiện thay đổi từng dòng và bắt khách xác nhận lại.
- [ ] Web, trang đơn hàng qua token: có đồng hồ đếm thời gian giữ hàng còn lại. Phần hiển thị đơn tách thành component dùng chung `OrderView`, để trang tài khoản (ticket 11) dùng lại
- [ ] Trang đặt mua và trang đơn hàng có `noindex`, không SSR dữ liệu cá nhân
- [ ] `scripts/smoke.ts` kiểm trang đặt mua có `noindex`
- [ ] Có test qua HTTP:
  - đặt mua tạo đơn, giữ hàng và trả link; trang Tồn kho thấy số đang giữ; sản phẩm thành hết hàng khi số giữ bằng tồn;
  - giá đổi, ngừng bán, hết hàng, sản phẩm không còn xuất bản đều trả 409 theo dòng và không ghi gì; quá 5 cái bị từ chối;
  - cổng lỗi thì không có đơn, không giữ hàng;
  - nhiều khách đặt biến thể cuối cùng song song: đúng một đơn được tạo, các đơn khác 409, `reserved` không vượt `on_hand`;
  - snapshot: đổi giá, tên, chính sách sau khi đặt không đổi đơn; đơn lưu đúng phiên bản chính sách; sửa phí giao sau đó không đổi đơn;
  - điều chỉnh tồn xuống dưới số đang giữ trả 409 kèm mã đơn;
  - token sai không xem được đơn;
  - bảng sự kiện đơn không sửa, không xóa được (thử bằng SQL trực tiếp)
