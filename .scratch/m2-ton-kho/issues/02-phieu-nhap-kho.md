# 02: Phiếu nhập kho

**What to build:**
- Nhân viên có quyền `stock.adjust` ghi một lô hàng về bằng phiếu nhập: nhiều dòng SKU và số lượng, kèm tên nhà cung cấp, ngày hàng về và ghi chú. Phiếu được ghi toàn bộ hoặc không dòng nào.
- Phiếu không sửa, không xóa được; nhập sai thì làm điều chỉnh (ticket 01).
- Nhân viên xem danh sách phiếu và chi tiết từng phiếu để đối chiếu với hóa đơn nhà cung cấp.

**Blocked by:** 01 (Tồn theo biến thể, điều chỉnh và sổ xuất nhập)

**Status:** resolved

- [x] Migration: bảng `stock_receipt` (tên nhà cung cấp dạng chữ tự do, ngày hàng về, ghi chú, người tạo, thời điểm) append-only bằng trigger; dòng `stock_movement` loại `receipt` tham chiếu phiếu (bắt buộc với loại `receipt`, trống với loại khác)
- [x] `POST /api/admin/stock/receipts` (cần `stock.adjust`): số lượng mỗi dòng nguyên dương; SKU không tồn tại hoặc trùng trong phiếu thì lỗi theo dòng (`lines.<i>.sku`) và không dòng nào được ghi. Đi qua hàm thay đổi tồn của ticket 01. Nhập được cho mọi biến thể, kể cả của sản phẩm nháp hay lưu trữ và biến thể ngừng bán
- [x] Một phiếu là một transaction và một bản audit `stock.receipt.create` (nhà cung cấp, ngày, các dòng SKU, số lượng, tồn sau)
- [x] `GET /api/admin/stock/receipts` (phân trang, mới nhất trước) và `GET /api/admin/stock/receipts/:id`, cùng quyền xem với trang tồn. Sổ xuất nhập trả kèm id phiếu cho dòng loại `receipt`
- [x] Không có endpoint sửa hay xóa phiếu
- [x] Trang quản trị: trong nhóm **Kho**, trang Phiếu nhập gồm danh sách, form tạo phiếu (thêm dòng theo SKU, hiện tên sản phẩm và tồn hiện tại của SKU vừa nhập) và trang chi tiết. Dòng sổ loại nhập kho liên kết sang phiếu. Nhãn audit `stock.receipt.create`
- [x] Có test qua HTTP cho các trường hợp:
  - tạo phiếu làm tăng tồn và sinh dòng sổ có `on_hand_after` đúng;
  - một SKU không tồn tại hoặc trùng thì không dòng nào được ghi;
  - nhập được cho biến thể của sản phẩm nháp và biến thể ngừng bán;
  - hai phiếu cùng biến thể chạy song song cho tổng đúng;
  - không có `stock.adjust` thì 403;
  - không có cách sửa hay xóa phiếu

**Quyết định khi triển khai (2026-10-29):**
- Migration `20261029000200_stock_receipts`; route `api/src/routes/admin-stock-receipts.ts` mount tại `/api/admin/stock/receipts` (trước `/stock`). Schema shared: `StockReceiptRequest`, `StockReceipt`, `StockReceiptPage`, `StockReceiptQuery`; `StockMovement` có thêm `receiptId`. `Sku` trong `@ecommerce/shared` được export để dùng lại cho dòng phiếu.
- Tên nhà cung cấp bắt buộc (tối đa 200 ký tự); ngày hàng về dạng `YYYY-MM-DD`, lưu kiểu DATE; tối đa 500 dòng mỗi phiếu.
- SKU kiểm trước transaction (biến thể không bao giờ bị xóa, nên không có khe hở); lỗi trả 400 với mọi dòng sai trong một lần. `StockChange` có thêm `receiptId`.
- Phiếu không có `updated_at`: append-only bằng trigger như sổ xuất nhập. Có `seq` để sắp danh sách ổn định.
- Helper test dùng chung cho kho chuyển sang `api/test/support/stock.ts`.
- Trang quản trị `/admin/stock/receipts` (danh sách, form tạo phiếu tra tên và tồn khi nhập SKU) và `/admin/stock/receipts/:id`; sổ xuất nhập có liên kết "xem phiếu". Chưa xem bằng mắt.
