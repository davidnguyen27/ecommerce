# 03: Yêu cầu hủy đơn

**What to build:**
- Khách đã trả hoặc đã cọc gửi được yêu cầu hủy đơn khi hàng chưa giao đi.
- Nhân viên mở thao tác hủy của M6a ngay từ yêu cầu. Đơn hủy xong thì yêu cầu tự đóng.

**Blocked by:** 01

**Status:** ready-for-agent

- [ ] Tạo yêu cầu loại `cancel`: chỉ khi đơn `processing`, đã nhận tiền (`paid` hoặc `deposit_paid`) và chưa bàn giao (`not_prepared`, `preparing`). Không thỏa thì 409 kèm lý do. Đơn chưa trả thì khách dùng nút hủy sẵn có.
- [ ] `cancelPaidOrder` thành công thì mọi yêu cầu `cancel` đang mở của đơn sang `resolved`, kèm một tin hệ thống ("Đơn đã được hủy"), trong cùng transaction. Email "đã xong" của yêu cầu không gửi, vì khách đã nhận email "Đơn đã hủy".
- [ ] Web:
  - form gửi yêu cầu chỉ hiện loại "Hủy đơn" khi đủ điều kiện;
  - trang yêu cầu ở admin có nút mở `AdminCancelPaidForm` của đơn (người có `order.cancel_paid`).
- [ ] Test:
  - gửi được và không gửi được theo từng trạng thái đơn;
  - hủy đơn đóng yêu cầu và có tin hệ thống;
  - đơn đã bàn giao thì yêu cầu vẫn mở để nhân viên trả lời.

Spec: mục "Quy tắc" (hủy đơn).
