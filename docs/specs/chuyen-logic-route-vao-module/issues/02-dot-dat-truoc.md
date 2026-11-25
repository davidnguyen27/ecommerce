# 02: Chuyển mở, sửa, đóng đợt đặt trước vào `preorders/campaign-admin.ts`

**What to build:**
- Mở, sửa và đóng đợt đặt trước thành hàm của module. Route `admin-preorder-campaigns.ts` chỉ còn phần HTTP.

**Blocked by:** —

**Status:** resolved

- [x] `preorders/campaign-admin.ts` export:
  - `openCampaign(tx, audit, staffId, input, now)`, trả id;
  - `updateCampaign(tx, audit, mail, staffId, id, input, now)`;
  - `closeCampaign(tx, audit, id)`.
- [x] `checkNewVariants` và `mustBeFuture` chuyển theo.
- [x] Giữ nguyên:
  - thứ tự khóa: sản phẩm khi mở; đợt rồi các dòng suất theo `variant_id` khi sửa;
  - các quy tắc khi đã có đơn;
  - báo khách khi đổi thời gian giao (`notifyDeliveryChange`) và `notifiedOrders` trong audit;
  - không đổi gì thì không ghi audit.
- [x] Route còn parse, `requirePermission`, `audited(...)` gọi module, `loadCampaign` trả response. Các GET và `cancel-unsupplied` giữ nguyên.
- [x] `preorder-campaigns.test.ts`, `preorder-admin.test.ts`, `preorder-delivery.test.ts` và cả bộ test api xanh mà không sửa.

Spec: mục "Solution".

**Quyết định khi triển khai (2026-11-25):**
- `preorders/campaign-admin.ts` (240 dòng) export `openCampaign`, `updateCampaign` và `closeCampaign`. `conflict`, `notFound`, `checkNewVariants` và `mustBeFuture` chuyển theo, không export. Thân hàm dời nguyên văn; `currentStaff(req).id` thay bằng tham số `staffId`. Route giảm từ 380 còn 171 dòng.
- `mustBeFuture` khi mở đợt giờ chạy trong transaction thay vì ngay trước nó; vẫn ném trước mọi lệnh ghi nên response không đổi.
- Route dùng kiểu `CustomerMail` thay cho kiểu khai tại chỗ `{ emails, siteUrl }` (cùng hình dạng).
- `pnpm --filter api test`: 84 file, 821 test xanh, không sửa test. Typecheck, ESLint, Prettier sạch.
