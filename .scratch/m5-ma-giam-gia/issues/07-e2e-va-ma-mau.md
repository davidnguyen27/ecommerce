# 07: E2E mã giảm giá và mã mẫu ở local

**What to build:**
- Kiểm trọn luồng mã giảm giá trên app thật bằng Playwright, và cho người chạy local có sẵn một mã để thử.

**Blocked by:** 04, 05, 06

**Status:** resolved

- [x] E2E hàng sẵn: nhân viên tạo mã ở admin → khách thêm hàng vào giỏ, áp mã ở trang đặt mua, thấy tiền giảm và tổng mới → giả lập thanh toán → trang đơn hàng hiện tiền giảm → admin thấy đơn trong chi tiết mã và lọc được theo mã
- [x] E2E đặt trước: khách áp mã ở trang đặt trước, kiểm tiền cọc và phần còn lại sau giảm → giả lập trả cọc → trang đơn hiện tiền giảm
- [x] E2E mã hết hiệu lực lúc xác nhận: nhân viên tắt mã sau khi khách đã áp → khách xác nhận thấy hộp thoại → "Đặt không dùng mã" tạo đơn không có giảm
- [x] `scripts/demo-seed.ts`: khi chạy local thì tạo mã `DEMO10` (giảm 10%, tối đa 500.000, cả hai hình thức bán, hết hạn sau một năm). Không tạo khi seed vào bản deploy
- [x] Ghi vào `docs/agents/local-walkthrough.md` cách dùng mã mẫu

Spec: mục "Testing Decisions" (E2E), "Web" (`demo-seed`).

**Quyết định khi triển khai (2026-11-17):**
- `e2e/tests/voucher.spec.ts`, hai test:
  1. Hàng sẵn: chủ cửa hàng tạo mã qua form `/admin/vouchers/new`. Khách áp một mã khác (tạo qua API), mã đó bị tắt trước khi khách xác nhận, đặt mua bị 409 và hiện hộp chọn (kiểm lý do, tổng khi không dùng mã, có nút "Đặt không dùng mã"). Khách bấm "Quay lại", áp mã của chủ cửa hàng, đặt được, cổng giả lập đòi đúng tổng sau giảm, giả lập đã thanh toán. Kiểm trang đơn (dòng mã giảm giá, tổng), chi tiết đơn qua API quản trị, danh sách đơn của mã (API và trang chi tiết mã), link "Lọc ở danh sách đơn", và dòng giảm ở chi tiết đơn admin.
  2. Đặt trước: đưa AM90-TRANG-41 về hết hàng, đóng đợt cũ, mở đợt mới qua API. Khách áp mã ở trang đặt trước, kiểm dòng giảm, tiền cọc và phần còn lại sau giảm; cổng đòi đúng tiền cọc sau giảm; kiểm đơn qua API. **Không trả cọc**, vì đơn đã cọc không hủy được (M6) và sẽ chặn `preorder.spec` chạy lại trên cùng stack; đơn chờ cọc tự hết hạn, cuối test đóng đợt.
- **Lệch so với ticket:** nút "Đặt không dùng mã" chỉ được kiểm là có hiện, không bấm. Mỗi IP chỉ được đặt 5 lần mỗi giờ (tính cả lần bị 409), mà hai spec có sẵn đã dùng 2 lần; spec này dùng 3 lần (409, đặt mua, đặt trước), vừa đúng 5. Bấm nút đó sẽ thành 6. Nhánh này đã có test API ở ticket 03 (mã tắt thì 409, đặt lại không mã thì tạo đơn).
- `e2e/playwright.config.ts`: sửa chú thích. Một lượt E2E nay đặt đúng 5 lần, nên chạy lại trên cùng stack phải chờ một giờ hoặc dựng lại stack (trước là khoảng 4 lượt mỗi giờ).
- `scripts/demo-seed.ts`: `ensureDemoVoucher` tạo `DEMO10` (10%, tối đa 500.000, cả hai hình thức bán, 5 lượt mỗi khách, hết hạn sau một năm), chỉ khi chạy local (`LOCAL`), cả khi DB đã có dữ liệu demo; đã có mã thì bỏ qua. Lượt mỗi khách đặt 5 để người thử ở local dùng lại được. Chưa chạy thật script này (cần stack compose mặc định); đã lint và typecheck.
- `docs/agents/local-walkthrough.md`: thêm dòng về `DEMO10`.
- Đã chạy: `pnpm smoke --keep` đạt, rồi `E2E_CHANNEL=msedge pnpm e2e` đạt cả 5 test (dashboard, đặt trước, mua hàng, hai test mã giảm giá).
