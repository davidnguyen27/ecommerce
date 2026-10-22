# 13: Chứng từ private và cam kết có bằng chứng

**What to build:**
- Nhân viên đính kèm chứng từ nguồn hàng nội bộ (hóa đơn nhập, giấy tờ của nhà cung cấp) vào sản phẩm. Chứng từ không bao giờ công khai.
- Chỉ người có quyền `document.view` mới mở được chứng từ, qua một đường dẫn có hạn. Mỗi lần mở đều được ghi lại.
- Người có quyền `commitment.edit` (permission mới, mặc định chỉ owner) ghi **cam kết có bằng chứng** cho sản phẩm (ví dụ "bảo hành chính hãng"), tham chiếu tới chứng từ đã đính kèm, và quản lý danh sách **loại cam kết**.
- Bảo hành chỉ hiển thị cho khách dưới dạng cam kết có bằng chứng thuộc loại bảo hành; sản phẩm không có trường bảo hành riêng (ADR 0005).
- Trang chi tiết sản phẩm hiển thị cam kết có bằng chứng tách biệt khỏi thông tin công bố thông thường, để khách biết mức độ tin cậy. Nội dung chứng từ không bị lộ ra.

**Blocked by:** 10 (Ảnh sản phẩm và logo thương hiệu)

**Status:** ready-for-agent

- [ ] Chứng từ lưu trong bucket private qua interface storage của ticket 10. Nhận pdf, jpeg, png, webp; kiểm MIME type thật và giới hạn dung lượng
- [ ] Không có URL công khai nào cho chứng từ. Người có `document.view` lấy được URL ký có hạn; thiếu quyền thì 403
- [ ] Mỗi lần cấp URL ký đều ghi audit (ai mở, chứng từ nào, lúc nào)
- [ ] Thêm permission `commitment.edit` vào danh sách permission dùng chung; chỉ owner có theo mặc định
- [ ] Loại cam kết là danh sách đóng, seed sẵn (ít nhất: Bảo hành chính hãng, Bảo hành quốc tế, Có hóa đơn nhập khẩu); chạy seed lại không tạo trùng. Thêm, sửa loại cam kết yêu cầu `commitment.edit` và ghi audit
- [ ] Cam kết có bằng chứng gắn ở cấp sản phẩm, gồm một loại cam kết trong danh sách, nội dung hiển thị cho khách và tham chiếu tới một hoặc nhiều chứng từ của chính sản phẩm đó. Không tạo được cam kết khi không có chứng từ. Tạo, sửa, gỡ cam kết yêu cầu `commitment.edit` và ghi audit
- [ ] Không xóa được chứng từ đang được cam kết tham chiếu; lỗi kèm danh sách các cam kết đó
- [ ] API công khai của trang chi tiết sản phẩm trả về cam kết có bằng chứng (loại và nội dung hiển thị), không trả về chứng từ hay URL của chứng từ
- [ ] Trình soạn sản phẩm trong admin có mục chứng từ (tải lên, xem qua URL ký) và mục cam kết. Trang chi tiết sản phẩm hiển thị cam kết có bằng chứng có nhãn phân biệt
- [ ] Có test qua HTTP với storage giả cho các trường hợp:
  - thiếu `document.view` thì không lấy được URL;
  - mỗi lần lấy URL đều ghi audit;
  - API công khai không chứa chứng từ;
  - cam kết không có chứng từ bị từ chối;
  - có `catalog.edit` nhưng không có `commitment.edit` thì bị 403 khi tạo cam kết;
  - cam kết với loại không có trong danh sách bị từ chối;
  - xóa chứng từ đang được tham chiếu bị từ chối;
  - sản phẩm không có cam kết bảo hành thì API công khai không trả về bảo hành nào
