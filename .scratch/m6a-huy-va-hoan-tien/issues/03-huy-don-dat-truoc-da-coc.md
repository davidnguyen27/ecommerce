# 03: Hủy đơn đặt trước đã cọc, mất cọc, chia lại hàng đã về

**What to build:**
- Nhân viên bán hàng hủy được đơn đặt trước đã cọc, hoặc đã trả đủ mà chưa bàn giao. Số hoàn do nhân viên quyết theo lý do (mất cọc). Riêng "không nhập được hàng" thì luôn hoàn đủ.
- Hàng đã giữ cho đơn bị hủy chuyển cho đơn chờ kế tiếp cùng biến thể theo thứ tự cọc. Không còn đơn chờ thì hàng thành hàng sẵn.
- Suất của đơn trả lại cho đợt.

**Blocked by:** 02

**Status:** ready-for-agent

- [ ] Hàm hủy của ticket 02 thêm nhánh đơn `preorder`: phần `reserved_quantity > 0` của dòng đơn được chia lại cho đơn đang chờ theo cùng quy tắc với `planArrivals`/`applyArrivals` (ADR 0013), có khóa `FOR UPDATE`. Phần dư được nhả khỏi giữ hàng. Đơn chờ nào về đủ thì thành hàng đã về (hạn trả phần còn lại, sự kiện đơn, email "Hàng đã về").
  - Nếu cần, tách lõi chia hàng của `arrivals.ts` để phiếu nhập và hủy đơn dùng chung. Không chép logic sang chỗ khác.
- [ ] Đơn quá hạn trả phần còn lại hủy được với `remainder_overdue`. Không có job tự hủy.
- [ ] Hộp thoại hủy ở admin: với đơn đặt trước, hiện tiền cọc đã nhận và nhắc tham chiếu chính sách đặt trước. Chọn "không nhập được hàng" thì khóa ô số hoàn ở mức toàn bộ.
- [ ] Email "Đơn đã hủy" có biến thể cho đơn đặt trước: nêu số không hoàn khi có mất cọc.
- [ ] Test qua HTTP:
  - hủy đơn `deposit_paid` chưa về: không đổi tồn; suất đợt trống lại; lượt mã giảm giá trống lại;
  - hủy đơn đã về: hàng chuyển cho đơn chờ kế tiếp theo thứ tự cọc; đơn đó có hạn trả và email; không còn đơn chờ thì thành hàng sẵn (còn hàng);
  - đơn giữ một phần cũng chia đúng;
  - mất cọc: số hoàn < cọc kèm ghi chú thì được, có hoàn tiền đúng số;
  - `supply_failed` với số khác toàn bộ thì 400;
  - đơn đặt trước đã trả đủ chưa bàn giao hủy được, số có thể hoàn gồm cả hai giao dịch.

Spec: mục "Hủy đơn đã nhận tiền" (nhả hàng đặt trước), ADR 0013.
