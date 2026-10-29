# 04: Import sản phẩm và biến thể bằng file .xlsx

**What to build:**
- Nhân viên tải file mẫu .xlsx sinh từ dữ liệu hiện tại: mỗi nhóm hàng một sheet, cột sinh từ schema thuộc tính, có danh sách thả xuống cho thương hiệu, danh mục và giá trị enum.
- Nhân viên tải file lên để xem trước: hệ thống báo lỗi theo sheet, dòng, cột mà chưa ghi gì. Khi file hợp lệ, nhân viên xác nhận để ghi toàn bộ; có một lỗi là không ghi gì.
- Import tạo sản phẩm mới ở trạng thái nháp kèm biến thể và giá. Không sửa sản phẩm đã có.

Ticket này chưa có cột tồn đầu kỳ; ticket 05 thêm.

**Blocked by:** không có (dựa trên M0+M1)

**Status:** ready-for-agent

- [ ] Thêm `exceljs` vào API
- [ ] `GET /api/admin/import/template` (cần `catalog.edit`): mỗi nhóm hàng một sheet; mỗi dòng là một biến thể, các dòng cùng `slug` thuộc một sản phẩm. Cột:
  - cấp sản phẩm: slug, tên, thương hiệu, danh mục, mã mẫu, mô tả, hướng dẫn sử dụng/bảo quản, thông tin nguồn gốc công bố, chỉ giao đường bộ, mỗi thuộc tính cấp sản phẩm một cột;
  - cấp biến thể: SKU, mỗi thuộc tính cấp biến thể một cột, giá bán, giá hãng.

  Data validation: thương hiệu, danh mục (chỉ danh mục của nhóm hàng của sheet), enum, boolean. multi_enum ghi các giá trị cách nhau bằng `;`. Bảng size, chính sách, cam kết, ảnh không có trong file
- [ ] `POST /api/admin/import/preview` (multipart): kiểm toàn bộ file, trả số sản phẩm và biến thể sẽ tạo, danh sách lỗi `{ sheet, row, column, message }` và cảnh báo. Không ghi gì
- [ ] `POST /api/admin/import/commit` (multipart, gửi lại chính file đó): kiểm lại trong một transaction dưới các khóa như khi ghi thường (schema thuộc tính `FOR SHARE`, khóa danh mục), rồi ghi toàn bộ; có lỗi thì không ghi gì và trả lỗi như bước xem trước. Không lưu trạng thái giữa hai bước
- [ ] Luật ghi:
  - sản phẩm mới luôn ở trạng thái `draft`; kiểm theo đúng luật M1 (thuộc tính theo schema, SKU duy nhất, tổ hợp duy nhất trong sản phẩm, `price > 0`, giá hãng `>=` giá bán);
  - thương hiệu và danh mục ghép theo tên; không tạo thương hiệu hay danh mục mới;
  - slug đã thuộc về sản phẩm có sẵn thì lỗi (import không thêm biến thể vào sản phẩm đã có);
  - các dòng cùng slug phải giống nhau ở mọi cột cấp sản phẩm;
  - dòng có SKU đã tồn tại: không tạo gì; bước xem trước liệt kê là cảnh báo "SKU đã có, bỏ qua" (ticket 05 dùng dòng này cho tồn đầu kỳ)
- [ ] Quyền: cần `catalog.edit`; có điền ô giá nào thì cần thêm `price.edit`, thiếu thì 403 cho cả file kèm lý do
- [ ] Giới hạn 2.000 dòng biến thể và 5 MB; kiểm MIME thật như module media
- [ ] Audit trong cùng transaction: `catalog.product.create`, `catalog.variant.create`, `price.change` cho từng đối tượng như M1, và một bản `catalog.import` tóm tắt (tên file, số sản phẩm, số biến thể)
- [ ] Trang quản trị **Import**: tải file mẫu, chọn file, bảng kết quả xem trước (lỗi và cảnh báo theo sheet, dòng, cột), nút xác nhận chỉ bật khi không có lỗi. Nhãn audit `catalog.import`
- [ ] Có test qua HTTP cho các trường hợp:
  - file mẫu có đúng sheet và cột theo schema hiện tại;
  - file hợp lệ tạo sản phẩm nháp, biến thể và giá; xem trước không ghi gì;
  - một dòng lỗi thì commit không ghi gì;
  - thuộc tính sai schema báo lỗi đúng sheet, dòng, cột;
  - slug trùng sản phẩm có sẵn, thương hiệu hoặc danh mục không tồn tại, danh mục khác nhóm hàng của sheet đều bị lỗi;
  - có ô giá mà thiếu `price.edit` thì 403;
  - quá giới hạn dòng hoặc file không phải .xlsx bị từ chối
