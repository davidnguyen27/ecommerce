# 11: Xuất bản, lưu trữ và trang chi tiết sản phẩm

**What to build:**
- Nhân viên xuất bản sản phẩm khi đã đủ điều kiện, hoặc lưu trữ sản phẩm không còn kinh doanh mà không mất lịch sử.
- Nhân viên gắn các chính sách áp dụng (đổi trả, bảo hành) vào sản phẩm.
- Khách mở trang chi tiết sản phẩm trên điện thoại và thấy:
  - ảnh lớn;
  - bộ chọn biến thể, chỉ cho chọn những tổ hợp có thật; khi chọn thì giá, SKU và ảnh đổi theo; mỗi biến thể có URL riêng theo SKU, chia sẻ được;
  - giá gốc gạch ngang và giá bán;
  - thông số đặc trưng của nhóm hàng, có nhãn lấy từ schema;
  - bảng size, hướng dẫn sử dụng/bảo quản;
  - thông tin nguồn gốc công bố;
  - thông tin bảo hành, chỉ hiện khi đã xác nhận;
  - liên kết tới các chính sách áp dụng.
- Trang danh mục và trang thương hiệu hiển thị thẻ sản phẩm có giá "từ X ₫".

**Blocked by:** 04 (Trang nội dung có phiên bản và footer pháp lý), 10 (Ảnh sản phẩm và logo thương hiệu)

**Status:** ready-for-agent

- [ ] Chỉ xuất bản được sản phẩm có ít nhất 1 biến thể đang hoạt động và ít nhất 1 ảnh. Không đủ thì bị từ chối kèm lý do
- [ ] Lưu trữ thì sản phẩm biến mất khỏi API công khai nhưng vẫn còn trong admin cùng toàn bộ audit. Có thể đưa về nháp
- [ ] Gắn được chính sách vào sản phẩm (tham chiếu trang nội dung loại chính sách ở ticket 04)
- [ ] API công khai lấy chi tiết sản phẩm theo slug, trả về: thông tin sản phẩm, schema để hiển thị nhãn, các biến thể đang hoạt động kèm tổ hợp thuộc tính, giá và ảnh, và các chính sách. Sản phẩm draft hoặc archived trả 404
- [ ] API danh sách theo danh mục (gồm cả danh mục con) và theo thương hiệu trả về thẻ sản phẩm: giá thấp nhất trong các biến thể, giá gốc tương ứng, ảnh đại diện
- [ ] Trang chi tiết sản phẩm render SSR. Chọn biến thể qua tham số SKU trên URL; mở URL có SKU thì biến thể đó được chọn sẵn
- [ ] Bảo hành không hiển thị nếu sản phẩm chưa có thông tin bảo hành đã xác nhận
- [ ] Xuất bản và lưu trữ đều ghi audit
- [ ] Có test qua HTTP cho các trường hợp:
  - xuất bản thiếu biến thể hoặc thiếu ảnh bị từ chối;
  - sản phẩm draft hoặc archived không xuất hiện ở API công khai;
  - giá "từ X" đúng là giá thấp nhất của biến thể đang hoạt động;
  - biến thể ngừng hoạt động không được trả về
