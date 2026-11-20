# 09: Xuất Excel cho sáu báo cáo

**What to build:** Mỗi tab báo cáo có nút "Xuất Excel" tải file `.xlsx` theo bộ lọc đang chọn.

**Blocked by:** 02, 03, 04, 05, 06, 07

**Status:** ready-for-agent

- [ ] `GET /api/admin/reports/<báo cáo>.xlsx` cho `revenue`, `collections`, `stock`, `vouchers`, `cancellations`, `returns`. Cùng query và quyền với bản JSON, dùng lại đúng hàm tính số của bản JSON.
- [ ] Helper chung dựng workbook bằng `exceljs`:
  - dòng tiêu đề (tên báo cáo, kỳ, thời điểm xuất giờ VN);
  - một sheet cho mỗi bảng;
  - ô số định dạng `#,##0`;
  - tên file `bao-cao-<tab>-<from>-<to>.xlsx`.

  Xuất nhập tồn trả toàn bộ dòng.
- [ ] Web: nút "Xuất Excel" ở mỗi tab (tải qua `adminFetch` để có token).
- [ ] Test:
  - 403 khi không có quyền;
  - content type và tên file đúng;
  - đọc lại bằng `exceljs` thấy tiêu đề và ô số khớp bản JSON;
  - file không có email hay số điện thoại của khách.

Spec: "Xuất Excel".
