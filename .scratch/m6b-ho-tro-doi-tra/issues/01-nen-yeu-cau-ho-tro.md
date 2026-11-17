# 01: Nền yêu cầu hỗ trợ: tạo, tin nhắn, trạng thái, người phụ trách

**What to build:**
- Khách gửi được yêu cầu loại "khác" theo ba đường:
  - từ trang đơn qua link tra cứu (khách vãng lai);
  - từ trang đơn hoặc trang tài khoản (khách đã đăng nhập);
  - nhân viên tạo hộ.
- Hai bên nhắn tin trong yêu cầu; nhân viên có ghi chú nội bộ. Yêu cầu có trạng thái và người phụ trách.
- Khách nhận email khi có tiến triển. Bảng điều khiển hiện số việc đang chờ.

Đây là nền cho các ticket sau: chúng thêm loại mới và phần xử lý riêng của từng loại.

**Blocked by:** —

**Status:** ready-for-agent

- [ ] Migration:
  - sequence mã yêu cầu;
  - enum loại (đủ năm loại ngay từ đầu) và trạng thái;
  - bảng `support_request` (cột chung theo spec) và `support_message`;
  - check: bốn loại trừ `other` bắt buộc có đơn.

  Cột riêng của từng loại để các ticket sau thêm.
- [ ] Quyền `support.handle` (owner, sales). Xem yêu cầu: `support.handle` hoặc `order.view`.
- [ ] Module `api/src/support/`:
  - tạo yêu cầu (người tạo khách, nhân viên hoặc hệ thống; tên và email liên hệ lấy từ đơn hoặc tài khoản);
  - gửi tin (khách, nhân viên, ghi chú nội bộ);
  - chuyển trạng thái theo spec. Khách gửi tin khi `waiting_customer` thì yêu cầu thành `in_progress`; yêu cầu đã kết thúc thì 409;
  - nhận việc; giao việc (chỉ owner, `staff.manage`);
  - giới hạn 3 yêu cầu mở mỗi đơn (409).

  Mọi ghi ở admin qua `audited()` (`support.create`, `support.reply`, `support.note`, `support.status`, `support.assign`).
- [ ] API khách:
  - `/api/account/support-requests` (danh sách, tạo, chi tiết, gửi tin);
  - `/api/orders/:code/support-requests?token=…` (cùng các thao tác, theo token tra cứu đơn, sai token thì 404).

  Khách không thấy ghi chú nội bộ hay người phụ trách. Giới hạn tần suất: tạo 5/giờ/IP, tin 20/giờ/yêu cầu.
- [ ] API admin `/api/admin/support-requests`:
  - danh sách lọc theo trạng thái, loại, người phụ trách, `unassigned`; phân trang;
  - chi tiết;
  - tạo hộ, gửi tin hoặc ghi chú (kèm trạng thái mới tùy chọn), nhận, giao.

  Chi tiết đơn ở admin có danh sách yêu cầu của đơn. Bảng điều khiển có số yêu cầu chưa ai nhận và số đang chờ nhân viên (`new` + `in_progress`).
- [ ] Email cho khách (bản tạm), link vào trang yêu cầu (tài khoản, hoặc link tra cứu đơn có token mới):
  - đã nhận yêu cầu;
  - nhân viên trả lời;
  - yêu cầu đã xong / bị từ chối.
- [ ] Web:
  - khách: nút "Gửi yêu cầu" ở trang đơn, danh sách yêu cầu của đơn, trang yêu cầu (chuỗi tin, ô trả lời), mục "Yêu cầu hỗ trợ" trong tài khoản;
  - admin: mục "Yêu cầu hỗ trợ" (danh sách, chi tiết, trả lời, ghi chú nội bộ, nhận, giao, đổi trạng thái), số đếm ở bảng điều khiển, khối yêu cầu ở chi tiết đơn.
- [ ] Test qua HTTP:
  - tạo theo ba đường; khách khác hay token sai thì 404;
  - chuyển trạng thái đúng; tin vào yêu cầu đã kết thúc thì 409;
  - ghi chú nội bộ không lộ cho khách;
  - nhận và giao (giao bởi người không phải owner thì 403);
  - quá 3 yêu cầu mở thì 409; giới hạn tần suất trả 429;
  - email đúng lúc, không gửi với ghi chú nội bộ;
  - audit có trước và sau.

Spec: mục "Mô hình", "Quy tắc" (chuyển trạng thái), "Truy cập của khách", "Quyền", "Email", "Web".
