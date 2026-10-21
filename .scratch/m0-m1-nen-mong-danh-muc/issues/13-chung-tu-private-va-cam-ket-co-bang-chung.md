# 13: Chứng từ private và cam kết có bằng chứng

**What to build:**
- Nhân viên đính kèm chứng từ nguồn hàng nội bộ (hóa đơn nhập, giấy tờ của nhà cung cấp) vào sản phẩm. Chứng từ không bao giờ công khai.
- Chỉ người có quyền `document.view` mới mở được chứng từ, qua một đường dẫn có hạn. Mỗi lần mở đều được ghi lại.
- Nhân viên ghi **cam kết có bằng chứng** cho sản phẩm (ví dụ "bảo hành chính hãng"), tham chiếu tới chứng từ đã đính kèm.
- Trang chi tiết sản phẩm hiển thị cam kết có bằng chứng tách biệt khỏi thông tin công bố thông thường, để khách biết mức độ tin cậy. Nội dung chứng từ không bị lộ ra.

**Blocked by:** 10 (Ảnh sản phẩm và logo thương hiệu)

**Status:** ready-for-agent

- [ ] Chứng từ lưu trong bucket private qua interface storage của ticket 10. Nhận pdf, jpeg, png, webp; kiểm MIME type thật và giới hạn dung lượng
- [ ] Không có URL công khai nào cho chứng từ. Người có `document.view` lấy được URL ký có hạn; thiếu quyền thì 403
- [ ] Mỗi lần cấp URL ký đều ghi audit (ai mở, chứng từ nào, lúc nào)
- [ ] Cam kết có bằng chứng gồm loại cam kết, nội dung hiển thị cho khách và tham chiếu tới một hoặc nhiều chứng từ. Không tạo được cam kết khi không có chứng từ
- [ ] API công khai của trang chi tiết sản phẩm trả về cam kết có bằng chứng (loại và nội dung hiển thị), không trả về chứng từ hay URL của chứng từ
- [ ] Trình soạn sản phẩm trong admin có mục chứng từ (tải lên, xem qua URL ký) và mục cam kết. Trang chi tiết sản phẩm hiển thị cam kết có bằng chứng có nhãn phân biệt
- [ ] Có test qua HTTP với storage giả cho các trường hợp:
  - thiếu `document.view` thì không lấy được URL;
  - mỗi lần lấy URL đều ghi audit;
  - API công khai không chứa chứng từ;
  - cam kết không có chứng từ bị từ chối
