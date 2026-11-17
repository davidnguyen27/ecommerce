# 06: Bảo hành

**What to build:**
- Khách báo lỗi một dòng đơn đã giao, kèm mô tả và ảnh.
- Nhân viên thấy sản phẩm có cam kết bảo hành hay không. Nhân viên ghi các mốc: nhận hàng của khách → gửi hãng hay sửa → trả lại khách (mã vận đơn), và kết quả.
- Kết quả "đổi mới" hay "hoàn tiền" tạo yêu cầu đổi hoặc trả nối tiếp.

**Blocked by:** 05

**Status:** ready-for-agent

- [ ] Migration: các cột mốc bảo hành, kết quả (`repaired`, `replaced`, `rejected`, `refunded`) và ghi chú kết quả trên `support_request`, kèm check thứ tự mốc.
- [ ] Tạo yêu cầu `warranty`: một dòng của đơn `completed`, số lượng, mô tả. Chi tiết có `hasWarrantyCommitment`: sản phẩm của dòng có cam kết loại `warranty` (ADR 0005).
- [ ] Ghi mốc (`support.handle`), đúng thứ tự, sai thì 409. Không mốc nào đụng tới tồn.
- [ ] Kết quả (`support.handle`):
  - `repaired` cần đã trả lại khách;
  - `rejected` cần lý do;
  - `replaced` tạo yêu cầu `exchange` cùng biến thể, đã chấp nhận, nối với yêu cầu bảo hành (hàng cũ coi như đã nhận ở mốc bảo hành; kho chỉ còn bàn giao);
  - `refunded` tạo yêu cầu `return` đã chấp nhận, nối với yêu cầu bảo hành.

  Yêu cầu bảo hành thành `resolved` (hoặc `rejected`).
- [ ] Web:
  - khách: form bảo hành, mốc và kết quả ở trang yêu cầu;
  - admin: khối bảo hành (cảnh báo không có cam kết, các mốc, kết quả; xác nhận trước khi tạo yêu cầu nối tiếp).
- [ ] Test:
  - cảnh báo không có cam kết;
  - mốc sai thứ tự thì 409;
  - tồn không đổi qua các mốc;
  - `replaced` và `refunded` tạo yêu cầu nối tiếp đúng trạng thái;
  - `rejected` không có lý do thì 400.

Spec: mục "Quy tắc" (bảo hành), ADR 0005.
