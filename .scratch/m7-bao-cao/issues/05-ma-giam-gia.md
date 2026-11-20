# 05: Hiệu quả mã giảm giá

**What to build:** Tab Mã giảm giá. Mỗi mã có:
- số lượt;
- tổng tiền giảm;
- tiền hàng sau giảm;
- số đơn đã giao.

Chỉ tính đơn chưa hủy, tạo trong kỳ.

**Blocked by:** 01

**Status:** ready-for-agent

- [ ] `GET /api/admin/reports/vouchers` theo spec mục "Mã giảm giá". Sắp theo số lượt giảm dần.
- [ ] Web: tab Mã giảm giá. Mã link tới trang sửa mã.
- [ ] Test:
  - đơn hủy không tính;
  - kỳ theo ngày tạo đơn, không theo ngày giao;
  - tiền giảm là tiền chụp trên đơn;
  - số đơn đã giao đúng.

Spec: "Mã giảm giá".
