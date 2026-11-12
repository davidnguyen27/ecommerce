# 04: Import sản phẩm và biến thể bằng file .xlsx

**What to build:**
- Nhân viên tải file mẫu .xlsx sinh từ dữ liệu hiện tại: mỗi nhóm hàng một sheet, cột sinh từ schema thuộc tính, có danh sách thả xuống cho thương hiệu, danh mục và giá trị enum.
- Nhân viên tải file lên để xem trước: hệ thống báo lỗi theo sheet, dòng, cột mà chưa ghi gì. Khi file hợp lệ, nhân viên xác nhận để ghi toàn bộ; có một lỗi là không ghi gì.
- Import tạo sản phẩm mới ở trạng thái nháp kèm biến thể và giá. Không sửa sản phẩm đã có.

Ticket này chưa có cột tồn đầu kỳ; ticket 05 thêm.

**Blocked by:** không có (dựa trên M0+M1)

**Status:** resolved

- [x] Thêm `exceljs` vào API
- [x] `GET /api/admin/import/template` (cần `catalog.edit`): mỗi nhóm hàng một sheet; mỗi dòng là một biến thể, các dòng cùng `slug` thuộc một sản phẩm. Cột:
  - cấp sản phẩm: slug, tên, thương hiệu, danh mục, mã mẫu, mô tả, hướng dẫn sử dụng/bảo quản, thông tin nguồn gốc công bố, chỉ giao đường bộ, mỗi thuộc tính cấp sản phẩm một cột;
  - cấp biến thể: SKU, mỗi thuộc tính cấp biến thể một cột, giá bán, giá hãng.

  Data validation: thương hiệu, danh mục (chỉ danh mục của nhóm hàng của sheet), enum, boolean. multi_enum ghi các giá trị cách nhau bằng `;`. Bảng size, chính sách, cam kết, ảnh không có trong file
- [x] `POST /api/admin/import/preview` (multipart): kiểm toàn bộ file, trả số sản phẩm và biến thể sẽ tạo, danh sách lỗi `{ sheet, row, column, message }` và cảnh báo. Không ghi gì
- [x] `POST /api/admin/import/commit` (multipart, gửi lại chính file đó): kiểm lại trong một transaction dưới các khóa như khi ghi thường (schema thuộc tính `FOR SHARE`, khóa danh mục), rồi ghi toàn bộ; có lỗi thì không ghi gì và trả lỗi như bước xem trước. Không lưu trạng thái giữa hai bước
- [x] Luật ghi:
  - sản phẩm mới luôn ở trạng thái `draft`; kiểm theo đúng luật M1 (thuộc tính theo schema, SKU duy nhất, tổ hợp duy nhất trong sản phẩm, `price > 0`, giá hãng `>=` giá bán);
  - thương hiệu và danh mục ghép theo tên; không tạo thương hiệu hay danh mục mới;
  - slug đã thuộc về sản phẩm có sẵn thì lỗi (import không thêm biến thể vào sản phẩm đã có);
  - các dòng cùng slug phải giống nhau ở mọi cột cấp sản phẩm;
  - dòng có SKU đã tồn tại: không tạo gì; bước xem trước liệt kê là cảnh báo "SKU đã có, bỏ qua" (ticket 05 dùng dòng này cho tồn đầu kỳ)
- [x] Quyền: cần `catalog.edit`; có điền ô giá nào thì cần thêm `price.edit`, thiếu thì 403 cho cả file kèm lý do
- [x] Giới hạn 2.000 dòng biến thể và 5 MB; kiểm MIME thật như module media
- [x] Audit trong cùng transaction: `catalog.product.create`, `catalog.variant.create`, `price.change` cho từng đối tượng như M1, và một bản `catalog.import` tóm tắt (tên file, số sản phẩm, số biến thể)
- [x] Trang quản trị **Import**: tải file mẫu, chọn file, bảng kết quả xem trước (lỗi và cảnh báo theo sheet, dòng, cột), nút xác nhận chỉ bật khi không có lỗi. Nhãn audit `catalog.import`
- [x] Có test qua HTTP cho các trường hợp:
  - file mẫu có đúng sheet và cột theo schema hiện tại;
  - file hợp lệ tạo sản phẩm nháp, biến thể và giá; xem trước không ghi gì;
  - một dòng lỗi thì commit không ghi gì;
  - thuộc tính sai schema báo lỗi đúng sheet, dòng, cột;
  - slug trùng sản phẩm có sẵn, thương hiệu hoặc danh mục không tồn tại, danh mục khác nhóm hàng của sheet đều bị lỗi;
  - có ô giá mà thiếu `price.edit` thì 403;
  - quá giới hạn dòng hoặc file không phải .xlsx bị từ chối

**Quyết định khi triển khai (2026-10-29):**
- Module `api/src/catalog/import.ts` (`loadReference`, `buildTemplate`, `readWorkbook`, `planImport`, `hasPrices`), route `api/src/routes/admin-import.ts`: `GET /api/admin/import/template`, `POST /api/admin/import/preview`, `POST /api/admin/import/commit` (multipart, trường `file`). Schema shared ở `shared/src/import.ts` (`ImportPreview`, `ImportResult`, `ImportIssue`, `IMPORT_MAX_ROWS`).
- Tiêu đề cột có dạng `<nhãn>[ *] [<key>]`; key trong ngoặc vuông là thứ dùng khi đọc lại, nên người dùng đổi nhãn hay thứ tự cột vẫn đọc đúng. Thuộc tính cấp sản phẩm có key `sp.<key>`, cấp biến thể `bt.<key>`, để không trùng với cột cố định. Ticket 05 thêm cột `openingStock` theo cùng cách.
- **Danh mục ghi theo đường dẫn** từ gốc nhóm hàng (`Sneaker > Chạy bộ`), vì tên danh mục và tên thương hiệu **không có unique constraint** (khác với điều spec giả định). Tên trùng thì báo lỗi, không đoán. So khớp không phân biệt hoa thường.
- Danh sách thả xuống nằm ở sheet ẩn `Danh sách` (tránh giới hạn 255 ký tự của danh sách trong ô), gắn theo vùng 2.000 dòng. exceljs 4.4 thiếu khai báo type cho `worksheet.dataValidations`, nên có một type bổ sung trong module.
- Xác nhận khi có lỗi trả 400 `VALIDATION_ERROR`, `fields[].path` dạng `<sheet> / <dòng> / <cột>`; trang quản trị tự xem trước lại để hiện bảng lỗi.
- `audited()` nhận thêm `options.timeout` và cho `audit()` nhận một mảng (ghi bằng `createMany`). Import dùng timeout 120 giây; sản phẩm và biến thể ghi bằng `createMany`.
- Thiếu `price.edit` khi file có điền ô giá thì 403 ngay ở bước đọc file, cả xem trước lẫn xác nhận. Ô giá nhận số hoặc chuỗi có dấu phân cách hàng nghìn (`3.500.000`). multi_enum cách nhau bằng `;`, boolean và "Chỉ giao đường bộ" nhận `Có`/`Không`.
- Trang quản trị `/admin/import` (menu "Import từ Excel", quyền `catalog.edit`). Nhãn audit `catalog.import`, loại đối tượng `import`.
- Chưa thử mở file mẫu bằng Excel thật; test đọc lại bằng exceljs.
- Sau code review (2026-10-29): cùng một slug ở hai sheet là lỗi ngay khi xem trước (trước đó lọt tới bước xác nhận và thành 409 sai nguyên nhân). Xác nhận không tạo gì (mọi dòng có SKU đã tồn tại) trả 200 `{ products: 0, variants: 0 }` và không ghi audit.
- Người dùng quyết (2026-10-29): kiểm quyền giá **giữ nguyên**, có ô giá ở bất kỳ dòng nào (kể cả dòng bị bỏ qua vì SKU đã có) là cần `price.edit`. File không có worksheet nào (ví dụ .docx đổi đuôi; trước đó lọt qua và trả "0 sản phẩm, không lỗi") bị từ chối "File phải là Excel .xlsx"; file Excel không có sheet nhóm hàng nào bị từ chối kèm hướng dẫn dùng file mẫu.