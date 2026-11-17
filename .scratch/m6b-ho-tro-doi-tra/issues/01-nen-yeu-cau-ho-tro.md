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

**Status:** resolved

- [x] Migration:
  - sequence mã yêu cầu;
  - enum loại (đủ năm loại ngay từ đầu) và trạng thái;
  - bảng `support_request` (cột chung theo spec) và `support_message`;
  - check: bốn loại trừ `other` bắt buộc có đơn.

  Cột riêng của từng loại để các ticket sau thêm.
- [x] Quyền `support.handle` (owner, sales). Xem yêu cầu: `support.handle` hoặc `order.view`.
- [x] Module `api/src/support/`:
  - tạo yêu cầu (người tạo khách, nhân viên hoặc hệ thống; tên và email liên hệ lấy từ đơn hoặc tài khoản);
  - gửi tin (khách, nhân viên, ghi chú nội bộ);
  - chuyển trạng thái theo spec. Khách gửi tin khi `waiting_customer` thì yêu cầu thành `in_progress`; yêu cầu đã kết thúc thì 409;
  - nhận việc; giao việc (chỉ owner, `staff.manage`);
  - giới hạn 3 yêu cầu mở mỗi đơn (409).

  Mọi ghi ở admin qua `audited()` (`support.create`, `support.reply`, `support.note`, `support.status`, `support.assign`).
- [x] API khách:
  - `/api/account/support-requests` (danh sách, tạo, chi tiết, gửi tin);
  - `/api/orders/:code/support-requests?token=…` (cùng các thao tác, theo token tra cứu đơn, sai token thì 404).

  Khách không thấy ghi chú nội bộ hay người phụ trách. Giới hạn tần suất: tạo 5/giờ/IP, tin 20/giờ/yêu cầu.
- [x] API admin `/api/admin/support-requests`:
  - danh sách lọc theo trạng thái, loại, người phụ trách, `unassigned`; phân trang;
  - chi tiết;
  - tạo hộ, gửi tin hoặc ghi chú (kèm trạng thái mới tùy chọn), nhận, giao.

  Chi tiết đơn ở admin có danh sách yêu cầu của đơn. Bảng điều khiển có số yêu cầu chưa ai nhận và số đang chờ nhân viên (`new` + `in_progress`).
- [x] Email cho khách (bản tạm), link vào trang yêu cầu (tài khoản, hoặc link tra cứu đơn có token mới):
  - đã nhận yêu cầu;
  - nhân viên trả lời;
  - yêu cầu đã xong / bị từ chối.
- [x] Web:
  - khách: nút "Gửi yêu cầu" ở trang đơn, danh sách yêu cầu của đơn, trang yêu cầu (chuỗi tin, ô trả lời), mục "Yêu cầu hỗ trợ" trong tài khoản;
  - admin: mục "Yêu cầu hỗ trợ" (danh sách, chi tiết, trả lời, ghi chú nội bộ, nhận, giao, đổi trạng thái), số đếm ở bảng điều khiển, khối yêu cầu ở chi tiết đơn.
- [x] Test qua HTTP:
  - tạo theo ba đường; khách khác hay token sai thì 404;
  - chuyển trạng thái đúng; tin vào yêu cầu đã kết thúc thì 409;
  - ghi chú nội bộ không lộ cho khách;
  - nhận và giao (giao bởi người không phải owner thì 403);
  - quá 3 yêu cầu mở thì 409; giới hạn tần suất trả 429;
  - email đúng lúc, không gửi với ghi chú nội bộ;
  - audit có trước và sau.

Spec: mục "Mô hình", "Quy tắc" (chuyển trạng thái), "Truy cập của khách", "Quyền", "Email", "Web".

**Quyết định khi triển khai (2026-11-17):**
- Migration `20261117000700_support_requests`:
  - enum `support_request_kind` (đủ năm loại), `support_request_status`, `support_author`;
  - sequence mã yêu cầu bắt đầu từ 1001;
  - bảng `support_request` có thêm `subject` (tiêu đề 1–200 ký tự, để danh sách đọc được) và `contact_email`/`contact_name`;
  - bảng `support_message`.
- Check DB:
  - mọi loại trừ `other` có đơn; yêu cầu luôn có đơn hoặc tài khoản;
  - `resolved_at` ↔ đã kết thúc;
  - nhân viên tạo thì có nhân viên;
  - tin của nhân viên có nhân viên; ghi chú nội bộ chỉ nhân viên viết.
- `api/src/support/support.ts`:
  - tạo yêu cầu khóa đơn (hay dòng khách với yêu cầu không gắn đơn) `FOR UPDATE` rồi đếm yêu cầu đang mở. Giới hạn 3 áp cả cho yêu cầu không gắn đơn của một tài khoản;
  - mọi thay đổi khác khóa dòng yêu cầu;
  - nhận việc chuyển yêu cầu `new` thành `in_progress`. Yêu cầu người khác đã nhận thì 409 (owner giao lại);
  - giao việc kiểm người được giao còn hoạt động và có `support.handle`.
- Nhân viên trả lời và chuyển trạng thái trong một lời gọi (`/reply` với `message`, `internal`, `status`):
  - có tin gửi khách thì gửi một email "đã trả lời", kèm câu kết thúc nếu đóng cùng lúc;
  - chỉ đóng thì gửi email "đã xong" hoặc "không được chấp nhận";
  - ghi chú nội bộ không gửi email;
  - không có tin và trạng thái không đổi thì không ghi gì, kể cả audit.
- Truy cập của khách:
  - một bộ route dùng chung cho hai đường (`support-customer.ts`), chỉ khác phạm vi;
  - tài khoản thấy yêu cầu của mình và yêu cầu của các đơn đã gắn vào tài khoản;
  - token đơn thấy yêu cầu của đơn;
  - yêu cầu của người khác là 404.

  `CreateSupportRequest` có `orderCode` tùy chọn để trang đơn trong tài khoản gắn yêu cầu vào đơn của chính khách. Đơn của người khác thì 404.
- Khách thấy tin của nhân viên dưới tên "Cửa hàng", không thấy tên nhân viên.
- Link trong email:
  - yêu cầu có tài khoản: `/tai-khoan/yeu-cau/<mã>`;
  - yêu cầu vãng lai: `/yeu-cau/<mã>?don=<mã đơn>&token=…` (token tra cứu đơn mới, chỉ lưu hash).

  Không đặt dưới `/don-hang/<mã>/…`: Nuxt sẽ biến trang đơn thành trang cha.
- Tạo yêu cầu chỉ nhận `kind: 'other'` ở ticket này (các loại khác trả 400). Ticket 03–06 mở rộng schema cùng phần xử lý.
- Giới hạn tần suất: `support-create:ip` 5/giờ, `support-message:request` 20/giờ.
- Admin:
  - danh sách mặc định "chưa kết thúc", cũ trước; lọc theo trạng thái (cả `open`, `awaiting_staff`), loại, `assignee` (id hay `me`), `unassigned`, `orderCode`;
  - giao việc dùng danh sách nhân sự (chỉ owner đọc được), nên ô giao chỉ hiện với owner;
  - `AdminOrder.supportRequests` cho khối yêu cầu ở chi tiết đơn.
- Bảng điều khiển có hai số "Yêu cầu chưa ai nhận" và "Yêu cầu chờ nhân viên". Hai link có query nên kiểm quyền theo trang gốc (`gate`): `canOpen` so khớp nguyên chuỗi đường dẫn với menu, nên link có query sẽ không tìm thấy mục menu và hiện cho mọi người.
- Web:
  - `utils/supportClient.ts` (client cho hai đường), `SupportRequests.vue` (danh sách và form), `SupportThread.vue` (chuỗi tin và ô trả lời);
  - trang `/yeu-cau/[code]`, `/tai-khoan/yeu-cau/[code]`;
  - khối yêu cầu ở hai trang đơn và trang tài khoản;
  - admin: `/admin/support` (danh sách, chi tiết, tạo hộ), mục menu, khối ở chi tiết đơn.
- Test `api/test/support-requests.test.ts` (12 test).
- Kết quả: 12 test mới qua; cả bộ test API 656/656. Chưa chạy thử giao diện trên trình duyệt; E2E ở ticket 07.
