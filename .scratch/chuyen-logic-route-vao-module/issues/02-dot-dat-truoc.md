# 02: Chuyển mở, sửa, đóng đợt đặt trước vào `preorders/campaign-admin.ts`

**What to build:**
- Mở, sửa và đóng đợt đặt trước thành hàm của module. Route `admin-preorder-campaigns.ts` chỉ còn phần HTTP.

**Blocked by:** —

**Status:** ready-for-agent

- [ ] `preorders/campaign-admin.ts` export:
  - `openCampaign(tx, audit, staffId, input, now)`, trả id;
  - `updateCampaign(tx, audit, mail, staffId, id, input, now)`;
  - `closeCampaign(tx, audit, id)`.
- [ ] `checkNewVariants` và `mustBeFuture` chuyển theo.
- [ ] Giữ nguyên:
  - thứ tự khóa: sản phẩm khi mở; đợt rồi các dòng suất theo `variant_id` khi sửa;
  - các quy tắc khi đã có đơn;
  - báo khách khi đổi thời gian giao (`notifyDeliveryChange`) và `notifiedOrders` trong audit;
  - không đổi gì thì không ghi audit.
- [ ] Route còn parse, `requirePermission`, `audited(...)` gọi module, `loadCampaign` trả response. Các GET và `cancel-unsupplied` giữ nguyên.
- [ ] `preorder-campaigns.test.ts`, `preorder-admin.test.ts`, `preorder-delivery.test.ts` và cả bộ test api xanh mà không sửa.

Spec: mục "Solution".
