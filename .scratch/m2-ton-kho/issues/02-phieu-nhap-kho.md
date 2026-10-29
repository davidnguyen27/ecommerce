# 02: Phiếu nhập kho

**What to build:**
- Nhân viên có quyền `stock.adjust` ghi một lô hàng về bằng phiếu nhập: nhiều dòng SKU và số lượng, kèm tên nhà cung cấp, ngày hàng về và ghi chú. Phiếu được ghi toàn bộ hoặc không dòng nào.
- Phiếu không sửa, không xóa được; nhập sai thì làm điều chỉnh (ticket 01).
- Nhân viên xem danh sách phiếu và chi tiết từng phiếu để đối chiếu với hóa đơn nhà cung cấp.

**Blocked by:** 01 (Tồn theo biến thể, điều chỉnh và sổ xuất nhập)

**Status:** ready-for-agent

- [ ] Migration: bảng `stock_receipt` (tên nhà cung cấp dạng chữ tự do, ngày hàng về, ghi chú, người tạo, thời điểm) append-only bằng trigger; dòng `stock_movement` loại `receipt` tham chiếu phiếu (bắt buộc với loại `receipt`, trống với loại khác)
- [ ] `POST /api/admin/stock/receipts` (cần `stock.adjust`): số lượng mỗi dòng nguyên dương; SKU không tồn tại hoặc trùng trong phiếu thì lỗi theo dòng (`lines.<i>.sku`) và không dòng nào được ghi. Đi qua hàm thay đổi tồn của ticket 01. Nhập được cho mọi biến thể, kể cả của sản phẩm nháp hay lưu trữ và biến thể ngừng bán
- [ ] Một phiếu là một transaction và một bản audit `stock.receipt.create` (nhà cung cấp, ngày, các dòng SKU, số lượng, tồn sau)
- [ ] `GET /api/admin/stock/receipts` (phân trang, mới nhất trước) và `GET /api/admin/stock/receipts/:id`, cùng quyền xem với trang tồn. Sổ xuất nhập trả kèm id phiếu cho dòng loại `receipt`
- [ ] Không có endpoint sửa hay xóa phiếu
- [ ] Trang quản trị: trong nhóm **Kho**, trang Phiếu nhập gồm danh sách, form tạo phiếu (thêm dòng theo SKU, hiện tên sản phẩm và tồn hiện tại của SKU vừa nhập) và trang chi tiết. Dòng sổ loại nhập kho liên kết sang phiếu. Nhãn audit `stock.receipt.create`
- [ ] Có test qua HTTP cho các trường hợp:
  - tạo phiếu làm tăng tồn và sinh dòng sổ có `on_hand_after` đúng;
  - một SKU không tồn tại hoặc trùng thì không dòng nào được ghi;
  - nhập được cho biến thể của sản phẩm nháp và biến thể ngừng bán;
  - hai phiếu cùng biến thể chạy song song cho tổng đúng;
  - không có `stock.adjust` thì 403;
  - không có cách sửa hay xóa phiếu
