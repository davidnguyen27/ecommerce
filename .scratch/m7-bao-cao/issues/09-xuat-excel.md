# 09: Xuất Excel cho sáu báo cáo

**What to build:** Mỗi tab báo cáo có nút "Xuất Excel" tải file `.xlsx` theo bộ lọc đang chọn.

**Blocked by:** 02, 03, 04, 05, 06, 07

**Status:** resolved

- [x] `GET /api/admin/reports/<báo cáo>.xlsx` cho `revenue`, `collections`, `stock`, `vouchers`, `cancellations`, `returns`. Cùng query và quyền với bản JSON, dùng lại đúng hàm tính số của bản JSON.
- [x] Helper chung dựng workbook bằng `exceljs`:
  - dòng tiêu đề (tên báo cáo, kỳ, thời điểm xuất giờ VN);
  - một sheet cho mỗi bảng;
  - ô số định dạng `#,##0`;
  - tên file `bao-cao-<tab>-<from>-<to>.xlsx`.

  Xuất nhập tồn trả toàn bộ dòng.
- [x] Web: nút "Xuất Excel" ở mỗi tab (tải qua `adminFetch` để có token).
- [x] Test:
  - 403 khi không có quyền;
  - content type và tên file đúng;
  - đọc lại bằng `exceljs` thấy tiêu đề và ô số khớp bản JSON;
  - file không có email hay số điện thoại của khách.

Spec: "Xuất Excel".

## Quyết định khi triển khai

- **Route:** `GET /api/admin/reports/<báo cáo>.xlsx`, khai báo cạnh bản JSON trong `admin-reports.ts`. Hai bản gọi cùng hàm tính số, nên số trong file luôn khớp với số trên trang.
- **`api/src/reports/excel.ts` (`buildWorkbook`):**
  - mỗi bảng một sheet;
  - dòng 1 ghi tên báo cáo, kỳ, và thời điểm xuất theo giờ VN;
  - dòng 2 là tiêu đề cột, cố định khi cuộn;
  - ô số dùng định dạng `#,##0`, tỷ lệ dùng `0.0%`, dòng tổng in đậm.
- **Nội dung sheet** (tên sheet, cột, dòng) của từng báo cáo nằm ở `api/src/reports/exports.ts`.
- **Nhãn tiếng Việt cho file** được chép sang `api/src/reports/labels.ts`, vì API không dùng được nhãn ở `web/app/utils`. File có ghi chú phải giữ khớp hai bên.
- **Xuất nhập tồn** gọi `stockReport(..., { all: true })`: bỏ `LIMIT/OFFSET`, nên file có mọi dòng khớp bộ lọc.
- **Web:** component `ReportExportButton` (tên báo cáo, slug, query) tải file qua `adminFetch` (`responseType: 'blob'`), đặt tên file giống API. Tab Xuất nhập tồn gửi kèm bộ lọc đang chọn.
- File không có tên, số điện thoại, email hay địa chỉ khách. Test kiểm điều này trên cả sáu file với một đơn của khách có đủ thông tin.
