# Tiến độ /implement-spec M3: xong phần agent, cập nhật 2026-11-12

Nhánh tích hợp: `spec/m3-mua-hang`. Ghi chú cho subagent: `implement-spec-notes.md`. Danh sách sửa sau code review: `review-fixes.md`.

## Đã xong
- Ticket 01–15 đã merge và resolved.
- Code review toàn nhánh (Standards + Spec) đã chạy; các mục sửa đã merge (`d571fc0`).
- Đổi cổng PayOS → ZaloPay (ADR 0009, ticket 17), rồi ZaloPay → VNPAY (ADR 0010, ticket 18, 2026-11-11), vì ZaloPay sandbox cần tài khoản test do ZaloPay cấp tay. Người dùng chỉ dùng sandbox; `VNPAY_ENV` mặc định là `sandbox`.
- Ticket 16 (thử VNPAY sandbox) xong 2026-11-12: trả bằng thẻ NCB test, ghi nhận qua trang quay về (`querydr` sandbox lỗi `99`, xem ticket 16). Như vậy mọi ticket M3 đã resolved.
- CI trên GitHub chạy lần đầu (2026-11-10): cả 5 job xanh.
- Đã xóa mọi worktree agent và các nhánh `ticket/m3-*`, `fix/m3-review` đã merge.

## Còn lại
1. Ticket 13 còn ô "xem lượt chạy CI thật" chưa tick (CI đã xanh 2026-11-10).
2. Danh sách cần chủ doanh nghiệp xác nhận: spec "Further Notes" và mục "Cần chủ doanh nghiệp xác nhận" của từng ticket.
3. Thử tiền thật qua VNPAY: trước khi mở bán, ngoài M3 (hợp đồng merchant, URL production, phí, nhận tiền về TPBank; hỏi VNPAY về lỗi `querydr`; thử IPN qua tunnel).
4. Merge `ticket/m3-18-vnpay` về `spec/m3-mua-hang`, push, chạy CI.
