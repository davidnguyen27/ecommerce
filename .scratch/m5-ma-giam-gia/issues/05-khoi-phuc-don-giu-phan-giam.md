# 05: Khôi phục đơn từ đối soát giữ phần giảm

**What to build:**
- Khi kế toán khôi phục một đơn đã hủy hay hết hạn từ danh sách cần đối soát, đơn giữ nguyên phần giảm đã chụp và không kiểm lại mã, vì khách đã trả đúng số tiền ghi trên đơn. Nếu vì thế mà mã vượt tổng lượt, việc này được ghi lại để chủ doanh nghiệp thấy.

**Blocked by:** 03

**Status:** ready-for-agent

- [ ] `restoreOrder` không kiểm hạn, trạng thái tắt, tổng lượt hay lượt mỗi khách của mã; đơn giữ nguyên `discount`, `total`, tiền cọc đã chụp
- [ ] Nếu sau khi khôi phục số lượt đã dùng vượt tổng lượt của mã, sự kiện đơn và audit log `reconciliation.restore` ghi `voucher_over_limit` kèm mã, số đã dùng và tổng lượt
- [ ] Trang chi tiết đơn ở admin hiện sự kiện này dễ đọc (dùng cách hiện sự kiện đơn sẵn có)
- [ ] Test qua HTTP: khôi phục đơn hàng sẵn có mã khi mã đã hết lượt → thành công, phần giảm giữ nguyên, có `voucher_over_limit`; khôi phục khi mã còn lượt → không có `voucher_over_limit`; khôi phục đơn đặt trước có mã (tiền nhận bằng tiền cọc sau giảm) → `deposit_paid`

Spec: mục "Hủy, hết hạn, đối soát".
