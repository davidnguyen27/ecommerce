# Spec: M6b — Yêu cầu hỗ trợ, trả hàng, đổi hàng, bảo hành

**Status:** resolved

Nguồn: `docs/project-overview.md` (mục 2, 4, 5, 6, 7, 9), Out of Scope của spec M6a (`.scratch/m6a-huy-va-hoan-tien/spec.md`), và buổi làm rõ requirement ngày 2026-11-17 (23 câu, người dùng chấp nhận mọi đề xuất). M6b là nửa sau của M6 trong lộ trình M0 → M8. Nó chạy trên nền của M6a: hủy đơn đã nhận tiền, hoàn tiền (ADR 0014), nhận hàng hoàn về, loại sổ `return`. Quyết định kiến trúc: `docs/adr/0015-doi-hang-khong-tao-don-moi.md` (mới), `docs/adr/0005-bao-hanh-chi-la-cam-ket-co-bang-chung.md`, `docs/adr/0014-hoan-tien-la-truc-rieng.md`.

## Problem Statement

Sau M6a, cửa hàng hủy và hoàn được đơn, nhưng không có chỗ nào để khách **nhờ** cửa hàng làm gì:
- Khách muốn hủy đơn đã trả, trả một đôi giày không vừa, đổi size, hay báo đồng hồ bị lỗi: chỉ có cách gọi điện hay nhắn Zalo.
- Nhân viên không có danh sách việc, không biết ai đang lo việc nào, không có lịch sử trao đổi. Hàng khách gửi về để trả hay đổi không có chỗ ghi nhận gắn với đơn.
- Tổng quan dự án đòi việc đổi trả "có người chịu trách nhiệm và lịch sử xử lý". Chatbot ở M8 cũng cần một nơi để chuyển yêu cầu tới.

## Solution

Khách gửi **yêu cầu hỗ trợ** từ trang đơn hoặc trang tài khoản. Khách vãng lai gửi qua link tra cứu đơn; nhân viên cũng tạo hộ được. Mỗi yêu cầu thuộc một loại: hủy đơn, trả hàng, đổi hàng, bảo hành, khác. Yêu cầu là một chuỗi tin nhắn, khách đính kèm được ảnh, nhân viên có thêm ghi chú nội bộ. Mỗi yêu cầu có một người phụ trách và trạng thái *mới → đang xử lý ⇄ chờ khách → đã xong / từ chối*. Khách nhận email khi có tiến triển.

Mỗi loại có phần xử lý riêng, dùng lại những gì đã có:
- **Hủy đơn:** nhân viên hủy bằng thao tác của M6a.
- **Trả hàng:** chấp nhận, kho nhận hàng về (nhập lại tồn hay ghi hỏng), nhân viên đề xuất hoàn, kế toán hoàn tiền như M6a.
- **Đổi hàng:** chỉ sang biến thể cùng sản phẩm, cùng giá (ADR 0015). Hàng mới được giữ từ lúc chấp nhận và giao đi sau khi nhận được hàng cũ.
- **Bảo hành:** ghi các mốc nhận hàng của khách, gửi hãng hay sửa, trả lại khách, và kết quả.

Nhân viên được cảnh báo khi yêu cầu trả hay đổi đã quá **hạn đổi trả** của nhóm hàng; hệ thống không tự từ chối.

## User Stories

### Khách hàng

1. Là khách hàng, từ trang đơn tôi muốn gửi một yêu cầu (hủy đơn, trả hàng, đổi hàng, bảo hành, khác), để không phải gọi điện.
2. Là khách đã đăng nhập, tôi muốn gửi yêu cầu không gắn đơn (ví dụ hỏi về sản phẩm), và xem mọi yêu cầu của mình ở trang tài khoản.
3. Là khách vãng lai, tôi muốn gửi và theo dõi yêu cầu qua link tra cứu đơn đã nhận trong email.
4. Là khách hàng, khi trả hàng tôi muốn chọn dòng, số lượng, lý do và đính kèm ảnh.
5. Là khách hàng, khi đổi hàng tôi muốn chọn biến thể muốn nhận (size, màu khác), và biết ngay biến thể đó có đổi được không.
6. Là khách hàng, khi báo bảo hành tôi muốn mô tả lỗi và gửi ảnh.
7. Là khách hàng, tôi muốn trả lời nhân viên trong yêu cầu và nhận email khi nhân viên trả lời.
8. Là khách hàng, tôi muốn thấy trạng thái yêu cầu và kết quả (đã chấp nhận, đã nhận hàng, đã hoàn, đã gửi hàng đổi kèm mã vận đơn, kết quả bảo hành).
9. Là khách hàng, tôi muốn hủy được đơn đã trả bằng cách gửi yêu cầu hủy khi hàng chưa giao đi.

### Nhân viên bán hàng (chăm sóc khách)

10. Là nhân viên, tôi muốn danh sách yêu cầu lọc theo trạng thái, loại, người phụ trách, và hàng chờ "chưa ai nhận".
11. Là nhân viên, tôi muốn nhận một yêu cầu về mình; owner muốn giao yêu cầu cho người khác.
12. Là nhân viên, tôi muốn trả lời khách, ghi chú nội bộ khách không thấy, và chuyển trạng thái (chờ khách, đã xong, từ chối).
13. Là nhân viên, tôi muốn tạo yêu cầu thay cho khách gọi điện, gắn vào đơn của khách.
14. Là nhân viên, tôi muốn chấp nhận hay từ chối yêu cầu trả, đổi, bảo hành, kèm lời nhắn cho khách.
15. Là nhân viên, tôi muốn thấy yêu cầu đã quá hạn đổi trả bao nhiêu ngày, và sản phẩm có cam kết bảo hành hay không.
16. Là nhân viên, sau khi kho nhận hàng trả về, tôi muốn đề xuất số tiền hoàn (mặc định đã trừ phần giảm của mã, không gồm phí giao).
17. Là nhân viên, tôi muốn hủy đơn từ yêu cầu hủy, và yêu cầu tự đóng khi đơn đã hủy.
18. Là nhân viên, tôi muốn thấy cờ yêu cầu đổi đã chấp nhận mà quá 7 ngày chưa nhận được hàng cũ.

### Nhân viên kho, kế toán, chủ doanh nghiệp

19. Là nhân viên kho, tôi muốn ghi nhận hàng khách gửi trả hay đổi theo từng dòng: nhập lại tồn hoặc ghi hỏng.
20. Là nhân viên kho, sau khi nhận hàng cũ, tôi muốn bàn giao biến thể đổi với mã vận đơn.
21. Là nhân viên, với bảo hành, tôi muốn ghi lúc nhận hàng của khách, lúc gửi hãng hay sửa, lúc trả lại khách (mã vận đơn), và kết quả.
22. Là kế toán, tôi muốn thực hiện khoản hoàn sinh từ trả hàng như mọi khoản hoàn khác.
23. Là chủ doanh nghiệp, tôi muốn đặt số ngày đổi trả cho từng nhóm hàng.
24. Là chủ doanh nghiệp, tôi muốn bảng điều khiển hiện số yêu cầu chưa ai nhận và số đang chờ nhân viên.
25. Là chủ doanh nghiệp, tôi muốn mọi thao tác của nhân viên trên yêu cầu có trong audit log.

## Implementation Decisions

### Mô hình

- **Bảng `support_request`:**
  - **mã yêu cầu** số tăng dần (sequence riêng, khách thấy `#YC1001`);
  - **loại** (`cancel`, `return`, `exchange`, `warranty`, `other`) và **trạng thái** (`new`, `in_progress`, `waiting_customer`, `resolved`, `rejected`);
  - đơn (có thể trống; bắt buộc với bốn loại đầu, check DB), tài khoản khách (có thể trống), tên và email liên hệ (lấy từ đơn hoặc tài khoản);
  - người phụ trách (nhân viên, có thể trống), người tạo (khách, nhân viên hoặc hệ thống), yêu cầu trước đó (có thể trống);
  - **hạn đổi trả** chụp lúc gửi: số ngày, ngày giao, số ngày đã quá;
  - lúc tạo, lúc xong.
- **Bảng `support_message`:** yêu cầu, tác giả (khách, nhân viên), nhân viên, `internal` (ghi chú nội bộ), nội dung (1–5.000 ký tự), lúc tạo. Chỉ ghi thêm, không sửa.
- **Bảng `support_attachment`:** yêu cầu, tin nhắn (có thể trống), khóa file ở bucket `private`, loại nội dung, kích thước, người tải, lúc tạo.
- **Bảng `support_request_line`** (trả, đổi, bảo hành):
  - dòng đơn, số lượng (≥ 1), lý do (với trả hàng: `defective`, `wrong_fit`, `not_as_described`, `other`);
  - với đổi hàng: biến thể đổi sang, số đang giữ;
  - kết quả nhận hàng: số nhập lại tồn, số ghi hỏng, biến thể thực nhận.
- **Phần riêng của từng loại** là các cột có thể trống trên `support_request`, kèm check theo loại:
  - quyết định (chấp nhận hay từ chối, người quyết, lúc quyết);
  - lúc nhận hàng;
  - giao hàng đổi: đơn vị vận chuyển, mã vận đơn, lúc bàn giao;
  - bảo hành: các mốc và kết quả (`repaired`, `replaced`, `rejected`, `refunded`, kèm ghi chú);
  - lúc gắn cờ quá hạn gửi hàng đổi.
- **Bảng `return_window`:** nhóm hàng → số ngày (trống thì không cảnh báo).
- Sổ xuất nhập: dòng `return` và `sale` có thêm `support_request_id` (có thể trống). Các check cũ (trỏ về đơn) giữ nguyên.
- `RefundOrigin` thêm `return`, với `support_request_id` bắt buộc khi `origin = return`, theo cùng kiểu check của `refund_origin_check`.

### Quy tắc

- **Chuyển trạng thái:**
  - khách gửi tin khi yêu cầu `waiting_customer` thì yêu cầu thành `in_progress`;
  - `resolved` và `rejected` là kết thúc, không mở lại;
  - tin nhắn vào yêu cầu đã kết thúc trả 409;
  - nhân viên gửi tin không tự đổi trạng thái; nhân viên chọn trạng thái kèm tin.
- **Số lượng trả, đổi trên một dòng:**
  - tổng số lượng các yêu cầu trả và đổi chưa bị từ chối không vượt số lượng của dòng trừ số đã nhận về ở các lần trả trước;
  - chỉ gửi được khi đơn `completed` (đã giao);
  - kiểm dưới khóa đơn `FOR UPDATE`.
- **Hủy đơn:**
  - chỉ gửi được khi đơn `processing` + đã nhận tiền + chưa bàn giao;
  - `cancelPaidOrder` thành công thì mọi yêu cầu hủy đang mở của đơn tự sang `resolved`, kèm tin hệ thống.
- **Trả hàng:**
  1. chấp nhận hoặc từ chối (`support.handle`);
  2. nhận hàng về (`order.fulfill`): mỗi dòng nhập lại tồn + ghi hỏng = số lượng yêu cầu; phần nhập lại qua `changeStock` loại `return`, trỏ về đơn và yêu cầu;
  3. đề xuất hoàn (`support.handle`): mặc định là Σ(giá × số trả − phần giảm của dòng chia theo tỷ lệ số trả, làm tròn xuống tới đồng), không gồm phí giao; thấp hơn thì ghi chú bắt buộc; tạo khoản hoàn `origin = return` qua `createRefund` (ADR 0014);
  4. yêu cầu `resolved` khi đã đề xuất hoàn.

  Đơn giữ `completed`. Lượt mã giảm giá không đổi.
- **Đổi hàng (ADR 0015):**
  - biến thể đổi sang phải cùng sản phẩm, khác biến thể của dòng, đang bán, giá bán hiện tại bằng giá của dòng. Kiểm lúc gửi và lúc chấp nhận;
  - chấp nhận thì `reserveStock` biến thể mới, thiếu thì 409;
  - nhận hàng cũ (như trả hàng), rồi mới bàn giao biến thể mới (`order.fulfill`): `changeStock` loại `sale` trừ tồn và nhả số giữ, kèm mã vận đơn, rồi yêu cầu `resolved`;
  - từ chối hay kết thúc trước khi giao thì nhả giữ hàng;
  - job hằng ngày gắn cờ yêu cầu đổi đã chấp nhận quá 7 ngày chưa nhận hàng; không tự hủy;
  - **biến thể khách đang giữ** của một dòng là biến thể đổi sang của lần đổi gần nhất đã giao, nếu không có thì là biến thể gốc. Nhận hàng về ghi tồn cho biến thể thực nhận.
- **Bảo hành:**
  - hiện cảnh báo nếu sản phẩm của dòng không có cam kết loại `warranty` (ADR 0005);
  - các mốc ghi theo thứ tự: nhận hàng của khách → gửi hãng/sửa → trả lại khách (đơn vị vận chuyển, mã vận đơn). Không mốc nào đụng tới tồn;
  - kết quả `replaced` tạo yêu cầu đổi cùng biến thể, nối với yêu cầu bảo hành; `refunded` tạo yêu cầu trả hàng. Nhân viên xác nhận trước khi tạo.
- **Hạn đổi trả:** khi gửi yêu cầu trả hay đổi, lấy số ngày của nhóm hàng (nhiều nhóm hàng thì lấy số nhỏ nhất) và ngày giao (`delivered`), tính số ngày đã quá. Chụp vào yêu cầu. Không chặn.

### Ảnh đính kèm

- Khách và nhân viên đính kèm được ảnh JPEG/PNG/WebP, ≤ 5 MB mỗi ảnh, tối đa 5 ảnh mỗi tin và 20 ảnh mỗi yêu cầu.
- Kiểm loại file bằng nội dung (magic bytes), không tin `Content-Type`. Ảnh được xử lý lại như ảnh sản phẩm hiện có để bỏ metadata.
- Ảnh lưu ở bucket `private`; trả về qua URL ký có hạn (5 phút), chỉ cho người xem được yêu cầu.

### Truy cập của khách

- Khách đã đăng nhập: `/api/account/support-requests` (danh sách, tạo, chi tiết, gửi tin, tải ảnh), chỉ thấy yêu cầu của mình. Yêu cầu của đơn vãng lai đã gắn vào tài khoản cũng hiện ở đây.
- Khách vãng lai: `/api/orders/:code/support-requests?token=…` (danh sách, tạo, chi tiết, gửi tin, tải ảnh), bằng token tra cứu đơn như M3. Sai token thì 404 như M3.
- Khách không bao giờ thấy ghi chú nội bộ, người phụ trách hay audit.
- Giới hạn tần suất (`http/rate-limit.ts`, số tạm): tạo 5 lần/giờ/IP; tin 20/giờ/yêu cầu; ảnh 20/giờ/IP; tối đa 3 yêu cầu mở mỗi đơn (409).

### Quyền

- Quyền mới `support.handle` (owner, sales): nhận, giao (giao cho người khác chỉ owner, kiểm bằng `staff.manage`), trả lời, ghi chú, đổi trạng thái, tạo hộ, chấp nhận hay từ chối, đề xuất hoàn, ghi mốc bảo hành.
- Xem yêu cầu: `support.handle` hoặc `order.view`.
- Nhận hàng trả về và bàn giao hàng đổi: `order.fulfill`. Hủy đơn: `order.cancel_paid`. Thực hiện hoàn: `payment.refund`. Sửa hạn đổi trả: `content.edit`.
- Mọi ghi ở admin qua `audited()`, với các action `support.*`.

### Email

Gửi khi tạo yêu cầu, khi nhân viên trả lời (không gửi với ghi chú nội bộ), khi chấp nhận hay từ chối, khi giao hàng đổi (kèm mã vận đơn), khi xong. Link dẫn tới trang yêu cầu: qua tài khoản với khách đã đăng nhập, qua link tra cứu đơn có token mới với khách vãng lai. Nội dung là bản tạm.

### Web

- **Khách:**
  - trang đơn (token và tài khoản) có nút "Gửi yêu cầu" (form theo loại; trả và đổi chọn dòng, số lượng, lý do, biến thể đổi sang) và danh sách yêu cầu của đơn;
  - trang yêu cầu: tin nhắn, ảnh, trạng thái, kết quả, ô trả lời;
  - tài khoản có mục "Yêu cầu hỗ trợ".
- **Admin:**
  - mục "Yêu cầu hỗ trợ": danh sách lọc theo trạng thái, loại, người phụ trách, "chưa ai nhận", cờ quá hạn;
  - trang chi tiết: chuỗi tin, ghi chú nội bộ, ảnh, người phụ trách, trạng thái; khối thao tác theo loại (chấp nhận/từ chối, nhận hàng về, đề xuất hoàn, bàn giao hàng đổi, mốc bảo hành, link hủy đơn);
  - chi tiết đơn có khối yêu cầu của đơn;
  - bảng điều khiển có hai số đếm;
  - trang "Hạn đổi trả" theo nhóm hàng.

## Testing Decisions

- Test qua HTTP trên Postgres thật như M6a. Prior art: `order-cancel-paid.test.ts`, `order-failed-delivery.test.ts`, `refunds.test.ts`, `product-images.test.ts` (kiểm ảnh), `rate-limit.test.ts`.
- E2E:
  - khách đã nhận hàng gửi yêu cầu trả kèm ảnh → nhân viên chấp nhận → kho nhận về → đề xuất hoàn → kế toán ghi chuyển khoản → khách thấy đã hoàn;
  - một yêu cầu đổi size: giữ hàng, nhận hàng cũ, bàn giao size mới, khách thấy mã vận đơn.
- Các hành vi bắt buộc có test:
  - **Yêu cầu:** tạo theo ba đường; khách không thấy yêu cầu của người khác (404); trạng thái chuyển đúng; tin vào yêu cầu đã kết thúc trả 409; ghi chú nội bộ không lộ cho khách; nhận và giao người phụ trách; giới hạn tần suất và 3 yêu cầu mở; email đúng lúc.
  - **Ảnh:** đúng loại thì nhận; file giả đuôi ảnh thì 400; quá cỡ, quá số lượng thì 400; URL ký chỉ trả cho người xem được.
  - **Hủy đơn:** chỉ gửi được khi đủ điều kiện; hủy đơn tự đóng yêu cầu.
  - **Trả hàng:** số lượng vượt thì 400/409; nhận về ghi `return` đúng biến thể và yêu cầu; hoàn mặc định trừ phần giảm, không gồm phí giao; khoản hoàn `origin = return`; đơn vẫn `completed`; lượt mã không đổi.
  - **Đổi hàng:** biến thể khác giá, khác sản phẩm hay hết hàng thì không gửi được; chấp nhận giữ hàng; giao trước khi nhận hàng cũ thì 409; giao trừ tồn và ghi `sale`; từ chối nhả hàng; cờ quá 7 ngày; trả hay đổi tiếp theo biến thể khách đang giữ.
  - **Bảo hành:** cảnh báo không có cam kết; mốc sai thứ tự thì 409; không đổi tồn; kết quả đổi mới hay hoàn tiền tạo yêu cầu nối tiếp.
  - **Hạn đổi trả:** chụp đúng số ngày quá hạn; nhóm hàng không cấu hình thì không cảnh báo.

## Out of Scope

- Chatbot tạo yêu cầu (M8); chat thời gian thực; email hay thông báo cho nhân viên.
- Đổi sang sản phẩm khác hoặc giá khác (trả rồi mua lại); tính hay thu phí gửi hàng trong hệ thống.
- Tự tính thời hạn bảo hành; theo dõi hàng của khách khi gửi hãng như một kho riêng.
- Tự từ chối yêu cầu quá hạn đổi trả; tự hủy yêu cầu đổi quá hạn gửi hàng.
- Mở lại yêu cầu đã kết thúc; đánh giá mức hài lòng.
- Báo cáo đổi trả (M7).

## Further Notes

- GLOSSARY có mục mới **Hậu mãi**: **Yêu cầu hỗ trợ**, **Ghi chú nội bộ**, **Trả hàng**, **Đổi hàng**, **Hạn đổi trả**.
- Buổi làm rõ 2026-11-17 chốt:
  - một thực thể yêu cầu hỗ trợ có loại;
  - đổi hàng chỉ cùng sản phẩm, cùng giá, không đơn mới (ADR 0015);
  - ba đường gửi yêu cầu; có chuỗi tin nhắn và ghi chú nội bộ;
  - khách đính kèm được ảnh;
  - hạn đổi trả theo nhóm hàng, chỉ cảnh báo;
  - một spec;
  - trạng thái không mở lại; một người phụ trách, tự nhận hoặc owner giao;
  - quyền `support.handle`;
  - luồng trả hàng không hoàn phí giao, không trả lượt mã;
  - đổi hàng giữ hàng từ lúc chấp nhận, giao sau khi nhận hàng cũ, cờ sau 7 ngày;
  - nhiều yêu cầu mỗi đơn có giới hạn số lượng;
  - hàng đã đổi vẫn trả hay đổi tiếp theo dòng gốc;
  - bảo hành ghi mốc, không vào tồn;
  - yêu cầu hủy dùng thao tác của M6a;
  - email cho khách ở bốn lúc;
  - giới hạn tần suất;
  - đơn đặt trước như đơn hàng sẵn.
- **Chủ doanh nghiệp đã chốt (2026-11-18):**
  1. Hạn đổi trả 14 ngày từ lúc giao cho mọi nhóm hàng. Migration `20261118000100_return_window_default` đặt sẵn cho cả năm nhóm (nhóm đã cấu hình thì giữ nguyên); sửa ở trang "Hạn đổi trả".
  2. Cửa hàng chịu toàn bộ phí gửi hàng khi trả, đổi và bảo hành. Form của khách và email ghi rõ điều này. Phí giao của đơn gốc vẫn không hoàn khi trả hàng.
  3. Nội dung email: chủ doanh nghiệp giao cho cửa hàng soạn. Email theo từng lúc (nhận yêu cầu, trả lời, chấp nhận, xong, từ chối) và từng loại yêu cầu, ở `api/src/support/emails.ts`.
  4. Các con số chốt theo đề xuất:
     - đổi hàng: khách gửi hàng cũ trong 7 ngày sau khi được chấp nhận, quá hạn thì gắn cờ (trước là 14 ngày tạm). Cửa hàng chịu phí gửi nên 7 ngày là đủ, và không giữ hàng mới quá lâu;
     - giữ nguyên: tối đa 3 yêu cầu đang mở mỗi đơn (hay mỗi tài khoản); giới hạn tần suất tạo 5 lần/giờ/IP, tin 20 lần/giờ/yêu cầu, ảnh 20 lần/giờ/IP; ảnh ≤ 5 MB, 5 ảnh mỗi tin, 20 ảnh mỗi yêu cầu; số lượng mỗi dòng tối đa 5 (bằng giới hạn mua mỗi biến thể).
