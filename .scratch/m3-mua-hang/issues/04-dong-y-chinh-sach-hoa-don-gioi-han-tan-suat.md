# 04: Đồng ý chính sách, thông tin hóa đơn, giới hạn tần suất

**What to build:**
- Khách vãng lai phải tick đồng ý chính sách bảo mật trước khi đặt mua. Lần đồng ý được ghi kèm phiên bản chính sách.
- Khách mua bằng tiền công ty nhập được tên công ty, mã số thuế và địa chỉ xuất hóa đơn.
- Trang đặt mua hiện link chính sách đổi trả và bảo hành áp dụng cho các món trong đơn.
- Đặt mua bị giới hạn tần suất, để không ai giữ hàng ác ý được.

**Blocked by:** 03 (Đặt mua và giữ hàng)

**Status:** ready-for-agent

- [ ] `POST /api/checkout` nhận cờ đồng ý chính sách bảo mật. Khách vãng lai thiếu cờ thì 400 theo trường. Lần đồng ý được ghi kèm phiên bản chính sách, theo cơ chế đã có ở đăng ký khách (ticket 05 của M0–M1)
- [ ] Thông tin xuất hóa đơn công ty là tùy chọn (tên, mã số thuế, địa chỉ) và lưu snapshot trên đơn.
  - Nhập thiếu trường nào thì báo theo trường đó.
  - Mã số thuế: 10 số, hoặc 13 số có gạch nối trước 3 số cuối.
- [ ] Trang đặt mua có thêm:
  - checkbox đồng ý kèm link chính sách bảo mật, ẩn khi khách đã đăng nhập;
  - phần "Xuất hóa đơn công ty", thu gọn mặc định;
  - danh sách link chính sách đổi trả và bảo hành đang áp dụng cho các món, lấy từ `quote` hoặc từ phiên bản chính sách đã xuất bản.
- [ ] Giới hạn tần suất bằng `enforceRateLimits`:
  - 5 lần đặt mua mỗi giờ cho mỗi IP (bộ đếm cửa sổ);
  - tối đa 3 đơn đang `pending_payment` cho mỗi email (so chữ thường) và mỗi số điện thoại (đếm trong DB).

  Vượt giới hạn thì trả 429 kèm thông báo rõ.
- [ ] Có test qua HTTP:
  - khách vãng lai thiếu đồng ý bị từ chối, khách đã đăng nhập không cần;
  - thông tin hóa đơn được lưu đúng, thiếu trường bị từ chối;
  - vượt giới hạn theo IP trả 429;
  - email đã có 3 đơn chờ thì đơn thứ tư bị 429; sau khi một đơn hết hạn hoặc được thanh toán thì đặt được lại

**Ghi chú:** các con số giới hạn đang là tạm, chờ chủ doanh nghiệp xác nhận (spec "Further Notes").
