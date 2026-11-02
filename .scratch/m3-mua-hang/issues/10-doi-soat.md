# 10: Đối soát

**What to build:**
- Kế toán xem danh sách đơn cần đối soát (số tiền nhận, số tiền của đơn, lý do) và xử lý từng mục theo một trong hai cách: khôi phục đơn khi đủ điều kiện, hoặc ghi là đã xử lý ngoài hệ thống.

**Blocked by:** 06 (Hết hạn và hủy đơn chưa thanh toán), 07 (Đơn hàng ở trang quản trị)

**Status:** ready-for-agent

- [ ] Thêm quyền mới `payment.reconcile` (owner, accountant). Danh sách cần đối soát đọc được với `order.view`
- [ ] Khôi phục đơn chỉ được khi đủ ba điều kiện:
  - đơn đang `cancelled`;
  - tổng đã nhận bằng đúng tổng phải trả;
  - giữ lại được đủ hàng (qua hàm giữ hàng của kho). Không đủ hàng thì 409 theo dòng.

  Khôi phục xong: đơn thành `paid` + `processing`, gửi email đã nhận thanh toán, đóng mục đối soát.
- [ ] "Đã xử lý ngoài hệ thống": ghi chú bắt buộc (số tiền, mã giao dịch ngân hàng); đóng mục, không đổi trạng thái đơn
- [ ] Cả hai thao tác đi qua `audited()` và ghi sự kiện đơn
- [ ] Web:
  - menu "Cần đối soát", quyền `order.view`;
  - nút thao tác chỉ hiện với `payment.reconcile`;
  - trang chi tiết đơn có khối đối soát.
- [ ] Có test qua HTTP:
  - khôi phục được khi đủ điều kiện;
  - khôi phục khi thiếu hàng thì 409;
  - khôi phục khi lệch tiền bị từ chối;
  - đóng mục thiếu ghi chú thì 400;
  - thiếu `payment.reconcile` thì 403;
  - có ghi audit
