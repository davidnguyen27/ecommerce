# 04: Hủy hàng loạt khi đợt đặt trước không nhập được hàng

**What to build:**
- Khi nhà cung cấp báo không có hàng, nhân viên bán hàng bấm một lần ở chi tiết đợt để:
  - đóng đợt;
  - hủy mọi đơn đã cọc chưa có hàng về, mỗi đơn có hoàn tiền đủ;
  - gửi email cho từng khách.

**Blocked by:** 03

**Status:** resolved

- [x] `POST /api/admin/preorder-campaigns/:id/cancel-unsupplied`, cần cả `order.cancel_paid` và `preorder.manage`, body `{ note }` bắt buộc. Trong một transaction:
  - đóng đợt nếu đang mở;
  - hủy các đơn `processing` + `deposit_paid` có `arrived_at` trống, với `supply_failed` và hoàn đủ, qua cùng hàm hủy của ticket 02/03;
  - phần đã giữ một phần thành hàng sẵn, không chia lại cho đơn nào trong đợt;
  - trả danh sách mã đơn đã hủy.

  Audit: một dòng `preorder_campaign.cancel_unsupplied` cho thao tác, cộng một dòng cho mỗi đơn.
- [x] Endpoint xem trước (hoặc trả kèm chi tiết đợt): số đơn sẽ bị hủy và tổng tiền sẽ hoàn, cho hộp xác nhận.
- [x] Web admin: nút "Hủy các đơn chờ hàng (không nhập được)" ở chi tiết đợt, hộp xác nhận ghi số đơn và tổng tiền, ô ghi chú bắt buộc.
- [x] Test qua HTTP:
  - chỉ đơn đã cọc chưa về bị hủy; đơn đã về, đơn đã trả đủ và đơn chờ cọc không đổi (đơn chờ cọc vẫn tự hết hạn như M4);
  - mỗi đơn có hoàn tiền đủ và email;
  - đợt bị đóng;
  - phần giữ một phần thành hàng sẵn;
  - thiếu một trong hai quyền thì 403;
  - gọi lần hai không hủy thêm gì.

Spec: mục "Hủy hàng loạt khi đợt không nhập được hàng".

**Quyết định khi triển khai (2026-11-17):**
- `api/src/preorders/unsupplied.ts`:
  - `previewUnsupplied` liệt kê đơn chờ hàng (`DEPOSITED_PREORDER` của đợt, `arrived_at` trống), theo thứ tự cọc, kèm số còn hoàn được của từng đơn. Không ghi gì;
  - `cancelUnsupplied` chạy trong một transaction:
    1. khóa đợt `FOR UPDATE`;
    2. đóng đợt nếu còn mở. Đóng trước, để không khách nào đặt thêm vào đợt trong lúc các đơn đang bị hủy;
    3. với từng đơn: khóa đơn, đọc số còn hoàn được, rồi gọi `cancelPaidOrder` với `supply_failed`, hoàn đủ, ghi chú của thao tác.
- `cancelPaidOrder` có thêm tùy chọn `{ reallocate: false }`:
  - với tùy chọn này, phần hàng đã giữ của đơn về một phần thành hàng sẵn, thay vì chuyền cho các đơn cùng đợt sắp bị hủy;
  - hủy từng đơn lẻ vẫn chia lại như ticket 03.
- Audit: mỗi đơn có một dòng `order.cancel_paid` (từ `cancelPaidOrder`); thao tác có thêm một dòng `preorder.campaign.cancel_unsupplied` (đợt đã đóng chưa, ghi chú, mã các đơn đã hủy).
- Endpoint:
  - `GET /api/admin/preorder-campaigns/:id/cancel-unsupplied`: xem trước. Cần quyền xem đợt như các route khác của đợt (`order.view` hoặc `preorder.manage`);
  - `POST /api/admin/preorder-campaigns/:id/cancel-unsupplied`: body `{ note }` bắt buộc; trả `{ cancelledOrderCodes, campaign }`. `requirePermission` nhận nhiều quyền theo kiểu "có một là đủ", nên route xếp hai middleware nối nhau để đòi cả `order.cancel_paid` lẫn `preorder.manage`.
- Đơn đã cọc chưa về thì không có link phần còn lại (link chỉ tạo khi hàng đã về), nên thao tác hàng loạt không cần hủy link.
- Web:
  - trang chi tiết đợt có nút "Hủy các đơn chờ hàng (không nhập được)", chỉ hiện khi có cả hai quyền;
  - bấm nút thì nạp bản xem trước: danh sách đơn, số hoàn từng đơn, tổng; có ô ghi chú bắt buộc và hộp `confirm` trước khi gửi.
- Nhãn audit cho `order.cancel_paid` (thiếu từ ticket 02) và `preorder.campaign.cancel_unsupplied`.
- Tên action audit là `preorder.campaign.cancel_unsupplied`, theo quy ước có sẵn `preorder.campaign.close`, không phải `preorder_campaign.…` như ticket ghi.
- Đơn đã trả đủ không có test riêng. Đơn chỉ trả được phần còn lại sau khi hàng đã về đủ, nên luôn có `arrived_at` và đã bị loại cùng nhóm với đơn đã về (có test).
- Test `api/test/preorder-unsupplied.test.ts` (3 test). Không test được trường hợp "chỉ có một trong hai quyền", vì không role có sẵn nào chỉ có `order.cancel_paid` mà thiếu `preorder.manage` hay ngược lại (sales có cả hai). Test chỉ kiểm warehouse và accountant bị 403.
- Chưa chạy thử giao diện trên trình duyệt; E2E ở ticket 07.
