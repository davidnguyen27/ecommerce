# 01: Tồn theo biến thể, điều chỉnh và sổ xuất nhập

**What to build:**
- Mỗi biến thể có số tồn trong một kho duy nhất. Mọi thay đổi tồn để lại một dòng trong sổ xuất nhập chỉ ghi thêm: ai làm, lúc nào, vì sao, tăng hay giảm bao nhiêu và tồn sau thay đổi.
- Nhân viên có quyền `stock.adjust` điều chỉnh tồn của một biến thể với một lý do: kiểm kê (nhập số đếm thực tế), hàng hỏng hoặc mất hàng (nhập số giảm), khác (số tăng hoặc giảm, bắt buộc ghi chú).
- Nhân viên xem danh sách tồn và sổ xuất nhập trên trang quản trị; trang soạn sản phẩm hiện tồn của từng biến thể.

**Blocked by:** không có (dựa trên M0+M1)

**Status:** ready-for-agent

- [ ] Migration: cột `on_hand INTEGER NOT NULL DEFAULT 0` trên `product_variant` với check `on_hand >= 0`; bảng `stock_movement` (biến thể, `seq`, loại `receipt | adjustment | opening`, `quantity` khác 0 có dấu, `on_hand_after`, lý do điều chỉnh, ghi chú, nhân viên, thời điểm) append-only bằng trigger chặn UPDATE, DELETE, TRUNCATE. Enum lý do `stocktake | damaged | lost | other`. Có thể tạo sẵn cột tham chiếu phiếu nhập để ticket 02 dùng, hoặc để ticket 02 thêm
- [ ] Permission `stock.adjust` trong `@ecommerce/shared`, gán cho `warehouse` (owner có tất cả)
- [ ] Một hàm duy nhất trong module kho để thay đổi tồn: khóa các dòng biến thể `FOR UPDATE` theo thứ tự id, cập nhật `on_hand`, ghi dòng sổ, chạy trong transaction của `audited()`. Các ticket sau và M3, M6 dùng lại hàm này
- [ ] `POST /api/admin/stock/adjustments` (cần `stock.adjust`):
  - `stocktake` nhận `countedQuantity >= 0` và tự tính chênh lệch; số đếm bằng tồn hiện tại thì không ghi sổ, không audit, trả 200 với trạng thái hiện tại;
  - `damaged`, `lost` nhận `quantity` nguyên dương là số giảm;
  - `other` nhận `quantity` khác 0 có dấu, `note` bắt buộc;
  - mọi request gửi `expectedOnHand`; tồn hiện tại khác số này thì 409 `CONFLICT` kèm số tồn mới, không ghi gì;
  - kết quả làm tồn âm thì 409 có lỗi theo trường;
  - áp được cho mọi biến thể, kể cả của sản phẩm nháp hay lưu trữ và biến thể ngừng bán;
  - audit `stock.adjust` (SKU, tồn trước và sau, lý do, ghi chú)
- [ ] `GET /api/admin/stock` (cần `catalog.edit`, `price.edit` hoặc `stock.adjust`): danh sách biến thể kèm sản phẩm, thương hiệu, nhóm hàng, trạng thái và `onHand`; tìm theo SKU hoặc tên sản phẩm, lọc theo nhóm hàng, thương hiệu, trạng thái biến thể; sắp xếp theo tồn tăng/giảm hoặc theo tên; phân trang
- [ ] `GET /api/admin/stock/movements` (cùng quyền xem): lọc theo biến thể, loại, khoảng thời gian; mới nhất trước; phân trang
- [ ] `AdminProductDetail` trả thêm `onHand` cho từng biến thể
- [ ] Schema input/output ở `shared/src/stock.ts`
- [ ] Trang quản trị: nhóm menu **Kho** với trang Tồn kho (danh sách, lọc, nút điều chỉnh mở form theo biến thể, form giữ `expectedOnHand` lúc mở) và trang Sổ xuất nhập; trang soạn sản phẩm hiện tồn từng biến thể (chỉ đọc) kèm liên kết sang sổ của biến thể đó. Menu theo quyền. Nhãn tiếng Việt cho hành động `stock.adjust` trong `web/app/utils/auditLabels.ts`
- [ ] Có test qua HTTP cho các trường hợp:
  - kiểm kê tính đúng chênh lệch và `on_hand_after`; kiểm kê bằng tồn hiện tại thì không có dòng sổ và audit;
  - hỏng/mất giảm đúng; `other` thiếu ghi chú bị từ chối;
  - làm tồn âm bị 409; `expectedOnHand` lệch bị 409 và không ghi gì;
  - hai lần giảm song song trên cùng biến thể không làm tồn âm;
  - không có `stock.adjust` thì 403; có `catalog.edit` hoặc `price.edit` thì xem được tồn và sổ;
  - không có cách sửa hay xóa dòng sổ;
  - lọc sổ theo biến thể, loại, thời gian
