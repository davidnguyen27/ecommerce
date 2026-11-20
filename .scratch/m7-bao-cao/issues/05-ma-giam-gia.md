# 05: Hiệu quả mã giảm giá

**What to build:** Tab Mã giảm giá. Mỗi mã có:
- số lượt;
- tổng tiền giảm;
- tiền hàng sau giảm;
- số đơn đã giao.

Chỉ tính đơn chưa hủy, tạo trong kỳ.

**Blocked by:** 01

**Status:** resolved

- [x] `GET /api/admin/reports/vouchers` theo spec mục "Mã giảm giá". Sắp theo số lượt giảm dần.
- [x] Web: tab Mã giảm giá. Mã link tới trang sửa mã.
- [x] Test:
  - đơn hủy không tính;
  - kỳ theo ngày tạo đơn, không theo ngày giao;
  - tiền giảm là tiền chụp trên đơn;
  - số đơn đã giao đúng.

Spec: "Mã giảm giá".

## Quyết định khi triển khai

- **API:** `GET /api/admin/reports/vouchers?from&to`, query `ReportQuery` (bỏ qua `groupBy`). Response có các dòng (chỉ mã có ít nhất một lượt trong kỳ) và dòng tổng.
- **Mã và mức giảm** (`kind`, `amount`, `percent`, `maxDiscount`) lấy theo cấu hình hiện tại của mã, để web dùng lại `voucherValueLabel`. Tiền giảm là số chụp trên từng đơn.
- **Đơn đã giao** = `fulfillment_status = delivered`, tính tới lúc xem, không giới hạn theo kỳ.
- Mã link tới trang sửa mã khi người xem mở được trang đó (`canOpen('/admin/vouchers')`).
- **Test** đặt ngày tạo đơn về trước bằng `prisma.order.update`. Bảng `order` không phải bảng chỉ ghi thêm, nên không cần tắt trigger.
- Ô "Nhóm theo" ở bộ chọn kỳ chỉ hiện ở tab Doanh thu và Tiền thu; các tab khác là bảng của cả kỳ.
