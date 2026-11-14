# 03: Khách thấy "Đang nhận đặt trước"

**What to build:**
- Biến thể hết hàng sẵn nhưng thuộc đợt đang mở và còn suất hiện "Đặt trước" kèm mức cọc và thời gian giao dự kiến. Thẻ sản phẩm có nhãn "Đặt trước". Biến thể còn hàng sẵn không bao giờ hiện đặt trước.

**Blocked by:** 02

**Status:** ready-for-agent

- [ ] API sản phẩm trả tình trạng từng biến thể: `in_stock` | `preorder` (kèm id đợt, tỷ lệ cọc, thời gian giao dự kiến) | `out_of_stock`. Không trả số lượng hay số suất. Điều kiện của `preorder` theo đúng spec: đã xuất bản, có trong phiên bản đang xuất bản, không ngừng bán, `on_hand - reserved = 0`, đợt đang mở, số đã dùng < suất
- [ ] Thẻ sản phẩm và kết quả tìm kiếm có cờ đặt trước khi không còn biến thể nào còn hàng sẵn nhưng có ít nhất một biến thể `preorder`. Bộ lọc "còn hàng" và sắp xếp "còn hàng trước" không đổi (chỉ tính hàng sẵn)
- [ ] JSON-LD `availability`: `InStock`, `PreOrder`, `OutOfStock`
- [ ] Trang sản phẩm: biến thể `preorder` có nhãn và nút "Đặt trước" thay cho "Thêm vào giỏ". Nút dẫn tới `/dat-truoc/<variantId>` (trang này làm ở ticket 04, tạm thời hiện thông báo chưa mở)
- [ ] Test qua HTTP: còn hàng sẵn thì `in_stock` dù có đợt; hết suất, đợt đóng tay, quá hạn đóng, ngừng bán, sản phẩm lưu trữ thì `out_of_stock`; cờ thẻ sản phẩm và JSON-LD đúng; bộ lọc còn hàng loại hàng đặt trước

Spec: mục "Hiển thị cho khách".
