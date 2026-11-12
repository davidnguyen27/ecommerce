# 05: Tồn đầu kỳ qua import

**What to build:**
- File import có thêm cột tồn đầu kỳ. Import ghi tồn đầu kỳ cho biến thể mới tạo và cho biến thể đã có (dòng có SKU đã tồn tại).
- Tồn đầu kỳ chỉ ghi được một lần cho mỗi biến thể: khi biến thể chưa có dòng nào trong sổ xuất nhập. Import chạy lại nhầm không cộng tồn hai lần.

**Blocked by:** 01 (Tồn theo biến thể, điều chỉnh và sổ xuất nhập), 04 (Import sản phẩm và biến thể bằng file .xlsx)

**Status:** resolved

- [x] File mẫu có thêm cột tồn đầu kỳ (số nguyên `>= 0`) ở cấp biến thể
- [x] Ghi tồn đầu kỳ qua hàm thay đổi tồn của ticket 01, loại `opening`, chỉ khi biến thể chưa có dòng sổ nào; điều kiện kiểm dưới khóa dòng biến thể. Biến thể đã có dòng sổ thì lỗi theo dòng. Ô trống hoặc 0 thì không ghi gì
- [x] Dòng có SKU đã tồn tại: chỉ dùng cột tồn đầu kỳ; các cột khác được bỏ qua và bước xem trước liệt kê là cảnh báo "chỉ ghi tồn đầu kỳ". Bước xem trước trả thêm số biến thể sẽ ghi tồn đầu kỳ
- [x] Có điền ô tồn đầu kỳ nào thì cần thêm `stock.adjust`; thiếu thì 403 cho cả file kèm lý do
- [x] Audit `stock.opening` cho từng biến thể trong cùng transaction; bản `catalog.import` có thêm số biến thể đã ghi tồn đầu kỳ. Nhãn audit `stock.opening`; trang Sổ xuất nhập hiện loại "Tồn đầu kỳ"
- [x] Có test qua HTTP cho các trường hợp:
  - import tạo biến thể mới kèm tồn đầu kỳ; sổ có một dòng `opening` với `on_hand_after` đúng;
  - SKU đã có, chưa có dòng sổ: ghi được tồn đầu kỳ, thông tin sản phẩm không đổi;
  - biến thể đã có dòng sổ (điều chỉnh, nhập kho hoặc tồn đầu kỳ trước đó) thì lỗi và cả file không được ghi;
  - chạy lại cùng một file lần thứ hai bị lỗi, tồn không đổi;
  - có ô tồn đầu kỳ mà thiếu `stock.adjust` thì 403

**Quyết định khi triển khai (2026-10-29):**
- Cột key `openingStock` ("Tồn đầu kỳ") đứng sau "Giá hãng". Ô nhận số nguyên từ 0 tới 1.000.000, đọc như ô giá (chấp nhận dấu phân cách hàng nghìn).
- `changeStock` cho `plan` là hàm async, để kiểm "chưa có dòng sổ" lúc đã giữ khóa biến thể. Bước xem trước cũng kiểm (đếm `stockMovements` của SKU đã có), nhưng chỉ để báo sớm; lần kiểm quyết định là lần dưới khóa khi xác nhận.
- `ImportPreview` và `ImportResult` có thêm `openingStocks`. Xác nhận trả 201 khi tạo sản phẩm hoặc ghi tồn đầu kỳ, 200 khi không đổi gì.
- Dòng có SKU đã tồn tại: có tồn đầu kỳ thì cảnh báo "chỉ ghi tồn đầu kỳ, các cột khác được bỏ qua"; trống hoặc 0 thì giữ cảnh báo "dòng này được bỏ qua" như ticket 04.
- Audit `stock.opening` chỉ có `after` (`sku`, `onHand`), vì trước đó tồn luôn là 0 và không có dòng sổ nào.
- Sau code review (2026-10-29): hai dòng cùng một SKU đã có từng ghi tồn đầu kỳ hai lần (kiểm SKU trùng chỉ chạy cho SKU mới); giờ mọi dòng đi qua cùng một bước kiểm SKU trùng, có test. `planImport` trả một danh sách `openings` (theo SKU) cho cả biến thể mới lẫn đã có; route đổi SKU sang id và ghi qua `recordOpeningStocks`. `fileHasErrors` đổi tên thành `invalidImportFile`.
