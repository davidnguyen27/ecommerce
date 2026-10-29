# 05: Tồn đầu kỳ qua import

**What to build:**
- File import có thêm cột tồn đầu kỳ. Import ghi tồn đầu kỳ cho biến thể mới tạo và cho biến thể đã có (dòng có SKU đã tồn tại).
- Tồn đầu kỳ chỉ ghi được một lần cho mỗi biến thể: khi biến thể chưa có dòng nào trong sổ xuất nhập. Import chạy lại nhầm không cộng tồn hai lần.

**Blocked by:** 01 (Tồn theo biến thể, điều chỉnh và sổ xuất nhập), 04 (Import sản phẩm và biến thể bằng file .xlsx)

**Status:** ready-for-agent

- [ ] File mẫu có thêm cột tồn đầu kỳ (số nguyên `>= 0`) ở cấp biến thể
- [ ] Ghi tồn đầu kỳ qua hàm thay đổi tồn của ticket 01, loại `opening`, chỉ khi biến thể chưa có dòng sổ nào; điều kiện kiểm dưới khóa dòng biến thể. Biến thể đã có dòng sổ thì lỗi theo dòng. Ô trống hoặc 0 thì không ghi gì
- [ ] Dòng có SKU đã tồn tại: chỉ dùng cột tồn đầu kỳ; các cột khác được bỏ qua và bước xem trước liệt kê là cảnh báo "chỉ ghi tồn đầu kỳ". Bước xem trước trả thêm số biến thể sẽ ghi tồn đầu kỳ
- [ ] Có điền ô tồn đầu kỳ nào thì cần thêm `stock.adjust`; thiếu thì 403 cho cả file kèm lý do
- [ ] Audit `stock.opening` cho từng biến thể trong cùng transaction; bản `catalog.import` có thêm số biến thể đã ghi tồn đầu kỳ. Nhãn audit `stock.opening`; trang Sổ xuất nhập hiện loại "Tồn đầu kỳ"
- [ ] Có test qua HTTP cho các trường hợp:
  - import tạo biến thể mới kèm tồn đầu kỳ; sổ có một dòng `opening` với `on_hand_after` đúng;
  - SKU đã có, chưa có dòng sổ: ghi được tồn đầu kỳ, thông tin sản phẩm không đổi;
  - biến thể đã có dòng sổ (điều chỉnh, nhập kho hoặc tồn đầu kỳ trước đó) thì lỗi và cả file không được ghi;
  - chạy lại cùng một file lần thứ hai bị lỗi, tồn không đổi;
  - có ô tồn đầu kỳ mà thiếu `stock.adjust` thì 403
