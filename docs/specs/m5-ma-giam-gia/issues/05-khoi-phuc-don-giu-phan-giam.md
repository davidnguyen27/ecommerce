# 05: Khôi phục đơn từ đối soát giữ phần giảm

**What to build:**
- Khi kế toán khôi phục một đơn đã hủy hay hết hạn từ danh sách cần đối soát, đơn giữ nguyên phần giảm đã chụp và không kiểm lại mã, vì khách đã trả đúng số tiền ghi trên đơn. Nếu vì thế mà mã vượt tổng lượt, việc này được ghi lại để chủ doanh nghiệp thấy.

**Blocked by:** 03

**Status:** resolved

- [x] `restoreOrder` không kiểm hạn, trạng thái tắt, tổng lượt hay lượt mỗi khách của mã; đơn giữ nguyên `discount`, `total`, tiền cọc đã chụp
- [x] Nếu sau khi khôi phục số lượt đã dùng vượt tổng lượt của mã, sự kiện đơn và audit log `reconciliation.restore` ghi `voucher_over_limit` kèm mã, số đã dùng và tổng lượt
- [x] Trang chi tiết đơn ở admin hiện sự kiện này dễ đọc (dùng cách hiện sự kiện đơn sẵn có)
- [x] Test qua HTTP: khôi phục đơn hàng sẵn có mã khi mã đã hết lượt → thành công, phần giảm giữ nguyên, có `voucher_over_limit`; khôi phục khi mã còn lượt → không có `voucher_over_limit`; khôi phục đơn đặt trước có mã (tiền nhận bằng tiền cọc sau giảm) → `deposit_paid`

Spec: mục "Hủy, hết hạn, đối soát".

**Quyết định khi triển khai (2026-11-16):**
- `restoreOrder` vốn không đụng tới mã: phần giảm, tổng và tiền cọc nằm sẵn trong đơn nên giữ nguyên. Chỉ thêm `voucherOverLimitOf(tx, order)`: đơn có mã, mã có tổng lượt, và số lượt đã dùng (tính sau khi đơn đã thành `processing`) lớn hơn tổng lượt thì trả `{ code, used, totalLimit }`.
- Dữ liệu này ghi vào `data.voucherOverLimit` của sự kiện `restored` và vào `after.voucherOverLimit` của audit `reconciliation.restore`; không vượt thì không có khóa này. Chỉ xét tổng lượt; lượt mỗi khách không ghi.
- Không khóa dòng mã khi khôi phục: thông tin chỉ để ghi lại, không chặn gì.
- Web: lịch sử thao tác ở chi tiết đơn admin hiện "Mã X vượt tổng lượt: đã dùng a/b" dưới dòng "Khôi phục đơn sau đối soát".
- Test `api/test/reconciliation-voucher.test.ts` (3 test). Tiền về được giả lập bằng cổng giả trong bộ nhớ, qua truy vấn `refresh=1`; mã đơn bên cổng của đơn hàng sẵn là mã đơn, của link cọc là `<mã>-deposit-1`.
