# 09: Thời gian giao dự kiến thay đổi thì báo khách

**What to build:**
- Khi nhân viên đổi thời gian giao dự kiến của đợt, mọi khách đã cọc mà chưa về hàng nhận email nêu thời gian cũ và mới. Trang đơn của khách luôn hiện thời gian giao dự kiến hiện tại của đợt, cạnh thời gian lúc đặt.

**Blocked by:** 05

**Status:** resolved

- [x] Sửa đợt (ticket 02) mà đổi "từ ngày" hoặc "đến ngày" → trong cùng transaction, xếp email cho mỗi đơn của đợt đang `deposit_paid` và chưa `arrived_at`. Sự kiện đơn ghi thời gian cũ và mới
- [x] Các thay đổi khác (suất, hạn đóng, trạng thái nhập hàng, ghi chú) không gửi email
- [x] Trang đơn (khách và admin): thời gian giao dự kiến hiện tại của đợt, và thời gian lúc đặt nếu khác
- [x] Test qua HTTP: đổi thời gian thì gửi đúng một email cho mỗi đơn đã cọc chưa về; đơn chờ cọc, đơn đã về, đơn hủy không nhận; sửa trường khác thì không gửi; lưu lại cùng thời gian không gửi

Spec: mục "Đợt đặt trước", "Email".

**Quyết định khi triển khai (2026-11-16):**
- Không có migration.
- `notifyDeliveryChange(tx, mail, campaignId, { before, after, staffId })` (`api/src/preorders/delivery.ts`), gọi trong transaction sửa đợt (`PATCH /api/admin/preorder-campaigns/:id`) khi `deliveryFrom` hay `deliveryTo` thật sự đổi:
  - đơn được báo: thuộc đợt, `processing` + `deposit_paid`, chưa `arrived_at`;
  - với mỗi đơn: sự kiện `delivery_changed` (actor là nhân viên, `data.before` / `data.after`), email "Thời gian giao dự kiến của đơn đặt trước #… đã thay đổi" (trước đây / hiện tại, link trang đơn có token mới; bản nháp chờ chủ doanh nghiệp duyệt).
  Gửi lại đúng ngày cũ thì không tính là đổi (cơ chế "không đổi gì thì không ghi gì" của ticket 02), nên không gửi thư. Audit `preorder.campaign.update` có thêm `notifiedOrders` khi có đơn được báo. `adminPreorderCampaignRoutes` nhận thêm `mail`.
- Đơn vẫn giữ lời hẹn lúc đặt (`deliveryFrom`/`deliveryTo`). `ORDER_VIEW_INCLUDE` thêm `preorderCampaign` (hai ngày giao), và `OrderPreorder` có thêm `currentDeliveryFrom`/`currentDeliveryTo` là thời gian hiện tại của đợt. Trang đơn của khách hiện thời gian hiện tại, kèm "(đã đổi; lúc đặt là …)" khi khác; trang đơn admin có dòng giao dự kiến tương tự.
- **Sửa lỗi gửi thư có từ M3** (`api/src/jobs/jobs.ts`): nhiều thư xếp trong cùng một transaction chỉ sinh một NOTIFY (Postgres gộp các NOTIFY giống nhau), worker `send-email` lấy một thư rồi chờ lượt hỏi định kỳ, mặc định 30 giây với queue có notify. Lỗi này ảnh hưởng cả phiếu nhập làm nhiều đơn về đủ cùng lúc (ticket 06). Sửa bằng `notifyPollingIntervalSeconds: 2` cho worker này; vẫn lấy từng thư một, để thư lỗi chỉ thử lại chính nó. Test của ticket này phát hiện lỗi (chờ 10 giây vẫn thiếu thư thứ hai) và giờ là test hồi quy cho nó.
- Test: `api/test/preorder-delivery.test.ts` (3 test) dựng một đợt có đủ loại đơn: đã về hàng, hai đơn đã cọc đang chờ, chờ cọc, đã hủy. Toàn bộ bộ test API (49 file, 522 test) và test web (12) qua.
