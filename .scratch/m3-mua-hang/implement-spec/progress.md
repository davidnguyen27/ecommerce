# Tiến độ /implement-spec M3: xong phần agent, cập nhật 2026-11-10

Nhánh tích hợp: `spec/m3-mua-hang`, tip `fd330fb`. Ghi chú cho subagent: `implement-spec-notes.md`. Danh sách sửa sau code review: `review-fixes.md`.

## Đã xong
- Ticket 01–15 đã merge và resolved.
- Code review toàn nhánh (Standards + Spec) đã chạy; các mục sửa đã merge (`d571fc0`).
- Đổi cổng thanh toán PayOS → ZaloPay (ADR 0009, ticket 17) đã merge (`fd330fb`). Người dùng chỉ dùng ZaloPay sandbox; `ZALOPAY_ENV` mặc định là `sandbox`.
- Kiểm tra sau lần merge cuối: typecheck, lint, 441 test API + 9 test web, smoke, E2E 2/2 đều qua.
- Đã xóa mọi worktree agent và các nhánh `ticket/m3-*`, `fix/m3-review` đã merge.

## Còn lại
1. Ticket 16 (`ready-for-human`): thử ZaloPay sandbox (khóa từ sbmc.zalopay.vn, tunnel cho callback, các điểm chưa xác minh ghi trong ticket 17). M3 chỉ xong khi ticket này xong.
2. Push nhánh lên GitHub để CI chạy lần đầu (ticket 13 còn ô chưa tick). Hỏi người dùng trước.
3. `.env` local cần `PAYMENT_SIMULATOR=allow` cho `docker compose up`.
4. Danh sách cần chủ doanh nghiệp xác nhận: spec "Further Notes" và mục "Cần chủ doanh nghiệp xác nhận" của từng ticket.
5. Thử tiền thật qua ZaloPay: trước khi mở bán, ngoài M3.
