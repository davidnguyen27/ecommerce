# 02: Doanh thu theo nhóm hàng, thương hiệu, SKU

**What to build:** Tab Doanh thu có thêm ba bảng: theo nhóm hàng, theo thương hiệu, và top 50 SKU (doanh thu gộp và số lượng). Thương hiệu và nhóm hàng lấy theo sản phẩm hiện tại.

**Blocked by:** 01

**Status:** ready-for-agent

- [ ] `GET /api/admin/reports/revenue` trả thêm `byProductType`, `byBrand`, `topSkus` (SKU, tên sản phẩm chụp ở dòng đơn, số lượng, doanh thu gộp). Cùng tập đơn và cùng kỳ như bảng theo ngày.
- [ ] Web: ba bảng dưới bảng theo kỳ.
- [ ] Test:
  - tổng mỗi bảng chiều bằng doanh thu gộp;
  - phần giảm của dòng được trừ;
  - top SKU sắp theo doanh thu, tối đa 50;
  - hàng trả lại không chia xuống chiều.

Spec: "Doanh thu" (bảng theo chiều).
