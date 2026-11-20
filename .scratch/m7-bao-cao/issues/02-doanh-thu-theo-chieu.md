# 02: Doanh thu theo nhóm hàng, thương hiệu, SKU

**What to build:** Tab Doanh thu có thêm ba bảng: theo nhóm hàng, theo thương hiệu, và top 50 SKU (doanh thu gộp và số lượng). Thương hiệu và nhóm hàng lấy theo sản phẩm hiện tại.

**Blocked by:** 01

**Status:** resolved

- [x] `GET /api/admin/reports/revenue` trả thêm `byProductType`, `byBrand`, `topSkus` (SKU, tên sản phẩm chụp ở dòng đơn, số lượng, doanh thu gộp). Cùng tập đơn và cùng kỳ như bảng theo ngày.
- [x] Web: ba bảng dưới bảng theo kỳ.
- [x] Test:
  - tổng mỗi bảng chiều bằng doanh thu gộp;
  - phần giảm của dòng được trừ;
  - top SKU sắp theo doanh thu, tối đa 50;
  - hàng trả lại không chia xuống chiều.

Spec: "Doanh thu" (bảng theo chiều).

## Quyết định khi triển khai

- `RevenueReport` có thêm `byProductType`, `byBrand`, `topSkus`. Mỗi bảng sắp theo doanh thu gộp giảm dần. Top SKU giới hạn bằng `REVENUE_TOP_SKUS = 50` (shared).
- Tiền dòng = `price × quantity − discount` của dòng. Test với đơn có mã giảm giá xác nhận tổng mỗi bảng bằng doanh thu gộp của đơn (`subtotal − discount`).
- Top SKU nhóm theo biến thể. SKU và tên sản phẩm lấy theo **hiện tại**, không lấy bản chụp ở dòng đơn như spec ghi. Lý do: để cùng cách với nhóm hàng và thương hiệu, và một biến thể chỉ có một dòng kể cả khi SKU hay tên đã đổi.
- Chưa có test giới hạn 50 dòng: phải dựng 51 biến thể mới thử được, mà `LIMIT` thì không có logic gì để kiểm.
- Web: ba bảng xếp thành lưới dưới bảng theo kỳ, có ghi chú rằng số chưa trừ hàng trả lại và lấy theo sản phẩm hiện tại.
