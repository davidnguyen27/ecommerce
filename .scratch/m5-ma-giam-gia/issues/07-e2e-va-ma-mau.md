# 07: E2E mã giảm giá và mã mẫu ở local

**What to build:**
- Kiểm trọn luồng mã giảm giá trên app thật bằng Playwright, và cho người chạy local có sẵn một mã để thử.

**Blocked by:** 04, 05, 06

**Status:** ready-for-agent

- [ ] E2E hàng sẵn: nhân viên tạo mã ở admin → khách thêm hàng vào giỏ, áp mã ở trang đặt mua, thấy tiền giảm và tổng mới → giả lập thanh toán → trang đơn hàng hiện tiền giảm → admin thấy đơn trong chi tiết mã và lọc được theo mã
- [ ] E2E đặt trước: khách áp mã ở trang đặt trước, kiểm tiền cọc và phần còn lại sau giảm → giả lập trả cọc → trang đơn hiện tiền giảm
- [ ] E2E mã hết hiệu lực lúc xác nhận: nhân viên tắt mã sau khi khách đã áp → khách xác nhận thấy hộp thoại → "Đặt không dùng mã" tạo đơn không có giảm
- [ ] `scripts/demo-seed.ts`: khi chạy local thì tạo mã `DEMO10` (giảm 10%, tối đa 500.000, cả hai hình thức bán, hết hạn sau một năm). Không tạo khi seed vào bản deploy
- [ ] Ghi vào `docs/agents/local-walkthrough.md` cách dùng mã mẫu

Spec: mục "Testing Decisions" (E2E), "Web" (`demo-seed`).
