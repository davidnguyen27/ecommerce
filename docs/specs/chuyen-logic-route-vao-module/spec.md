# Spec: Chuyển logic nghiệp vụ khỏi route quản trị

**Status:** resolved

Nguồn: buổi review cấu trúc repo ngày 2026-11-25 (mục #1), nối tiếp ứng viên #4 của buổi `/codebase-design` ngày 2026-11-24. Đây là refactor: không đổi hành vi, không đổi contract API, không có migration, không có ADR mới.

## Problem Statement

Phần lớn route quản trị chỉ đọc body, gọi `audited()` với vài lệnh ghi đơn giản rồi trả response. Đó là pattern CRUD của dự án và nên giữ. Nhưng có ba route mang quy tắc nghiệp vụ thật nằm ngay trong handler:

| Route | Quy tắc nằm trong route |
|---|---|
| `admin-preorder-campaigns.ts` (380 dòng) | Mở đợt: khóa sản phẩm, mỗi sản phẩm một đợt đang mở, biến thể hợp lệ. Sửa đợt: khóa đợt rồi các dòng suất, khóa mức cọc và số ngày khi đã có đơn, suất không thấp hơn số đã dùng, không đổi hạn đợt đã đóng, báo khách khi đổi thời gian giao. Đóng đợt. |
| `admin-vouchers.ts` (291 dòng) | Tạo mã: kiểm phạm vi, mã trùng. Sửa mã: khóa dòng mã, đã tắt thì không sửa, đã có lượt dùng thì chỉ sửa vài trường, tổng lượt không thấp hơn số đã dùng, kiểm lại ràng buộc giữa các trường. Tắt mã. |
| `admin-products.ts` (325 dòng) | Tạo và sửa biến thể: quyền theo trường (`catalog.edit` hay `price.edit`), tổ hợp không trùng, còn biến thể đang bán, sản phẩm đã xuất bản phải có giá, đổi giá thì lên website ngay qua phiên bản mới. |

Hệ quả:
- Muốn hiểu quy tắc của đợt đặt trước, mã giảm giá hay biến thể thì phải đọc lẫn trong code HTTP: parse body, quyền, status code.
- Quy tắc nằm cạnh route nên chỉ thử được qua HTTP. Không sao với test hiện tại, nhưng module nghiệp vụ không có interface rõ ràng.
- `createVariant` và `updateVariant` nhận `req` chỉ để kiểm quyền và lấy id nhân viên.

## Solution

Chuyển phần ghi của ba route vào module nghiệp vụ, theo đúng pattern đã có ở `cancelPaidOrder` và `cancelUnsupplied`: hàm nhận `tx` của `audited()`, `audit`, id nhân viên và input đã parse, rồi trả kết quả. Route chỉ còn parse body, kiểm quyền vào route, gọi `audited(prisma, req, (tx, audit) => module(...))`, rồi đọc lại và trả response.

| Module mới | Hàm | Chuyển từ |
|---|---|---|
| `preorders/campaign-admin.ts` | `openCampaign`, `updateCampaign`, `closeCampaign` | `admin-preorder-campaigns.ts`: POST `/`, PATCH `/:id`, POST `/:id/close`, cùng `checkNewVariants` và `mustBeFuture` |
| `vouchers/voucher-admin.ts` | `createVoucher`, `updateVoucher`, `disableVoucher` | `admin-vouchers.ts`: POST `/`, PATCH `/:id`, POST `/:id/disable`, cùng `checkScope`, `normalize`, `columns`, `draftOf` |
| `catalog/variants.ts` | `createVariant`, `updateVariant` | `admin-products.ts`: cùng `resolveFields` và `assertVariant` |

**Quyền với biến thể:** hàm không nhận `req`. Thay vào đó nhận `actor: { staffId, canEditCatalog, canEditPrice }`, do route dựng từ `currentStaff(req)` và `hasPermission`. Quy tắc "đổi trường nào cần quyền nào" nằm trong module.

**Giữ ở route:** parse body và params, `requirePermission`, `audited()`, đọc lại để trả response (`loadCampaign`, `loadVoucher`), các GET.

## Implementation Decisions

- Không đổi chữ ký các hàm sẵn có của module (`loadCampaign`, `usedAllocations`, `loadVoucher`, `toVoucher`…).
- Thông điệp lỗi, `fields`, status code và nội dung audit (action, before, after) giữ nguyên từng chữ.
- Thứ tự khóa giữ nguyên:
  - đợt đặt trước → các dòng suất theo thứ tự biến thể;
  - sản phẩm → schema thuộc tính (`FOR SHARE`);
  - dòng mã giảm giá.
- Hàm module ném `AppError` như các module khác (`stock.ts`, `vouchers/apply.ts`).
- Comment tiếng Anh, ngắn (CODING_STANDARDS).

## Testing Decisions

- Test HTTP hiện có là lưới an toàn: `preorder-campaigns.test.ts`, `preorder-admin.test.ts`, `preorder-delivery.test.ts`, `vouchers-admin.test.ts`, `products.test.ts`, `product-publishing.test.ts`, cùng cả bộ test api. Mọi test phải xanh mà không sửa test. Phải sửa test là dấu hiệu hành vi đã đổi.
- Không thêm test gọi thẳng module (CODING_STANDARDS "Test": có đường HTTP thì đi HTTP).
- Mỗi ticket chạy: `pnpm --filter api test`, typecheck, lint.

## Out of Scope

- Các route CRUD đơn giản: thương hiệu, danh mục, trang nội dung, nhân viên, cam kết, chứng từ, ảnh.
- Đổi API, thêm tính năng.
- Gom kiểm quyền thành một cơ chế chung.

## Further Notes

- Ba ticket độc lập, làm theo thứ tự nào cũng được.
