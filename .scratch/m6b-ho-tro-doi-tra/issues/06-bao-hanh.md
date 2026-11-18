# 06: Bảo hành

**What to build:**
- Khách báo lỗi một dòng đơn đã giao, kèm mô tả và ảnh.
- Nhân viên thấy sản phẩm có cam kết bảo hành hay không. Nhân viên ghi các mốc: nhận hàng của khách → gửi hãng hay sửa → trả lại khách (mã vận đơn), và kết quả.
- Kết quả "đổi mới" hay "hoàn tiền" tạo yêu cầu đổi hoặc trả nối tiếp.

**Blocked by:** 05

**Status:** resolved

- [x] Migration: các cột mốc bảo hành, kết quả (`repaired`, `replaced`, `rejected`, `refunded`) và ghi chú kết quả trên `support_request`, kèm check thứ tự mốc.
- [x] Tạo yêu cầu `warranty`: một dòng của đơn `completed`, số lượng, mô tả. Chi tiết có `hasWarrantyCommitment`: sản phẩm của dòng có cam kết loại `warranty` (ADR 0005).
- [x] Ghi mốc (`support.handle`), đúng thứ tự, sai thì 409. Không mốc nào đụng tới tồn.
- [x] Kết quả (`support.handle`):
  - `repaired` cần đã trả lại khách;
  - `rejected` cần lý do;
  - `replaced` tạo yêu cầu `exchange` cùng biến thể, đã chấp nhận, nối với yêu cầu bảo hành (hàng cũ coi như đã nhận ở mốc bảo hành; kho chỉ còn bàn giao);
  - `refunded` tạo yêu cầu `return` đã chấp nhận, nối với yêu cầu bảo hành.

  Yêu cầu bảo hành thành `resolved` (hoặc `rejected`).
- [x] Web:
  - khách: form bảo hành, mốc và kết quả ở trang yêu cầu;
  - admin: khối bảo hành (cảnh báo không có cam kết, các mốc, kết quả; xác nhận trước khi tạo yêu cầu nối tiếp).
- [x] Test:
  - cảnh báo không có cam kết;
  - mốc sai thứ tự thì 409;
  - tồn không đổi qua các mốc;
  - `replaced` và `refunded` tạo yêu cầu nối tiếp đúng trạng thái;
  - `rejected` không có lý do thì 400.

Spec: mục "Quy tắc" (bảo hành), ADR 0005.

**Quyết định khi triển khai (2026-11-18):**
- Migration `20261117001100_support_warranty`:
  - enum `warranty_outcome`;
  - các cột `warranty_received_at`, `warranty_sent_at`, `warranty_returned_at`, `warranty_return_carrier`, `warranty_return_tracking_number`, `warranty_outcome`, `warranty_outcome_note` trên `support_request`;
  - `support_request_warranty_check`: mốc theo thứ tự; trả lại khách có đủ vận chuyển; `repaired` cần đã trả lại; `rejected` cần ghi chú; `replaced`/`refunded` cần đã nhận hàng; chỉ loại `warranty`;
  - bỏ điều kiện "biến thể đổi khác biến thể đang giữ" khỏi `support_request_line_exchange_check`, vì đổi mới theo bảo hành đổi đúng biến thể cũ. Khách tự đổi vẫn bị `assertExchangeable` chặn.
- Logic ở `api/src/support/warranty.ts`.
- Tạo yêu cầu `warranty`: đơn `completed` + `delivered`; đúng một dòng (theo biến thể gốc), số lượng ≤ số của dòng; mô tả là tin đầu tiên. Ghi biến thể khách đang giữ như trả/đổi. Bảo hành không chiếm số còn trả/đổi được của dòng.
- Không cần bước chấp nhận trước khi ghi mốc. `/decide` vẫn dùng được cho bảo hành nếu nhân viên muốn gửi hướng dẫn trước.
- Mốc (`POST …/:code/warranty-milestone`, `support.handle`): `received` → `sent` → `returned` (đơn vị vận chuyển + mã vận đơn). Sai thứ tự, ghi lại mốc đã có, đã có kết quả hay yêu cầu đã kết thúc thì 409. Mỗi mốc thêm tin cho khách; mốc đầu chuyển `new` → `in_progress`; `returned` gửi email kèm mã vận đơn. Audit `support.warranty_milestone`. Không đụng tới tồn.
- Kết quả (`POST …/:code/warranty-outcome`, `support.handle`, một lần): khóa đơn trước rồi mới khóa yêu cầu.
  - `repaired` cần đã trả lại khách;
  - `rejected` cần `note` (400), yêu cầu `rejected`;
  - `replaced`/`refunded` cần đã nhận hàng; tạo yêu cầu `exchange` (cùng biến thể khách đang giữ, giữ hàng ngay; thiếu thì 409 và không tạo gì) hay `return` (lý do `defective`). Yêu cầu nối tiếp do nhân viên tạo, `previousRequestId` trỏ về bảo hành, đã chấp nhận, đã nhận hàng (hàng cũ ghi hỏng, không nhập lại tồn), `in_progress`, chụp hạn đổi trả, không tính vào giới hạn yêu cầu đang mở. Dòng phải còn trả/đổi được, không thì 409.
  - Yêu cầu bảo hành `resolved` (hay `rejected`); tin và email kèm mã yêu cầu nối tiếp. Audit `support.warranty_outcome`.
- View: `warranty` (mốc, vận chuyển trả lại, kết quả, ghi chú) và `followUps` (mã, loại) cho khách và nhân viên; `hasWarrantyCommitment` cho nhân viên (route điền: sản phẩm của dòng có cam kết loại `warranty`).
- Web:
  - khách: loại "Báo lỗi, bảo hành" trong form khi đơn đã giao (chọn sản phẩm, số lượng); trang yêu cầu hiện mốc, mã vận đơn, kết quả và yêu cầu nối tiếp;
  - admin: `AdminSupportWarrantyPanel` (cảnh báo không có cam kết, mốc, form gửi trả, kết quả chỉ hiện lựa chọn hợp lệ ở mốc hiện tại, xác nhận trước khi ghi, link yêu cầu nối tiếp); nhãn audit.
- Test `api/test/support-warranty.test.ts` (6).
- Kết quả: 6 test mới qua; cả bộ test API 695/695. Chưa chạy thử giao diện trên trình duyệt; E2E ở ticket 07.
