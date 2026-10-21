# 08: Schema thuộc tính theo nhóm hàng

**What to build:**
- Mỗi nhóm hàng có một schema thuộc tính riêng, được seed sẵn theo bảng ở mục 3.1 của `project-overview.md`. Ví dụ: giày dép có hệ size, size, màu, chất liệu; nước hoa có dung tích, nồng độ, nhóm hương.
- Owner hoặc nhân viên có quyền xem và sửa schema trong trang quản trị.
- Hệ thống có một bộ kiểm dữ liệu theo schema, trả lỗi theo từng trường. Ticket 09 dùng bộ kiểm này cho sản phẩm và biến thể.

**Blocked by:** 07 (Thương hiệu và cây danh mục)

**Status:** ready-for-agent

- [ ] Mỗi định nghĩa thuộc tính gồm:
  - key ổn định, nhãn tiếng Việt;
  - kiểu `enum | multi_enum | text | number | boolean`;
  - bắt buộc hay không, danh sách giá trị cho phép (với kiểu enum), đơn vị (với kiểu number);
  - cấp áp dụng `product | variant`;
  - có dùng làm bộ lọc không, thứ tự hiển thị
- [ ] Seed sẵn schema cho cả 5 nhóm hàng; chạy seed lại không tạo trùng
- [ ] Bộ kiểm dữ liệu từ chối các trường hợp: thiếu trường bắt buộc, sai kiểu, giá trị enum không nằm trong danh sách, key không có trong schema. Lỗi trả theo cấu trúc lỗi từng trường
- [ ] Sửa schema yêu cầu `catalog.edit` và ghi audit kèm schema trước và sau khi sửa
- [ ] Quy tắc đổi schema đã cài sẵn: thêm thuộc tính bắt buộc, xóa thuộc tính hoặc bớt giá trị enum đều phải đi qua bước kiểm tra sản phẩm vi phạm. Ở ticket này chưa có sản phẩm nên bước kiểm luôn qua; ticket 09 bổ sung test cho trường hợp có sản phẩm vi phạm
- [ ] API công khai trả về schema của một nhóm hàng, để website hiển thị nhãn và bộ lọc
- [ ] Trang quản trị có màn hình xem và sửa schema của từng nhóm hàng
- [ ] Có test qua HTTP cho các trường hợp:
  - từng loại lỗi kiểm dữ liệu, thông qua một endpoint kiểm thử hoặc endpoint sửa schema;
  - sửa schema ghi audit;
  - kiểm tra quyền
