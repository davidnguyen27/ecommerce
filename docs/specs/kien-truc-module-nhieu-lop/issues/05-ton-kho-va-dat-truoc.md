# 05: Nhóm tồn kho và đặt trước

**What to build:**
- Tồn kho, phiếu nhập, đợt đặt trước. `stock` thay adapter tạm của ticket 03.

**Blocked by:** 02, 03

**Status:** resolved

- [x] Mỗi module (`stock`, `stock-receipt`, `preorder-campaign`) có đủ các lớp theo spec, mục "Cấu trúc thư mục"; module khác chỉ import qua `index.ts`.
- [x] Code cũ của nhóm này (route trong `routes/`, file trong thư mục miền cũ) bị xóa; `app.ts`/`modules/index.ts` gắn module mới.
- [x] Chuyển trạng thái nào cũng khóa dòng; audit trong transaction; thông điệp lỗi, `fields`, nội dung audit giữ nguyên từng chữ.
- [x] Typecheck, lint, bộ test api (CI) và `pnpm smoke` xanh mà không sửa test.

Spec: `docs/specs/kien-truc-module-nhieu-lop/spec.md`.

**Quyết định khi triển khai (2026-11-28):**
- `stock` và `stock-receipt` cùng một commit (0cb23c2): router `/stock` có guard chung, phải gắn sau `/stock/receipts`, như thứ tự cũ.
- `stock`: phần sổ tồn (`reserve`, `release`, `change`, `inStockIds`, `enoughStockIds`, `ordersHoldingVariant`) là `StockLedger` (`stock.ledger.ts`), không giữ trạng thái; `StockService` lo màn hình tồn và điều chỉnh. Code cũ chưa chuyển dùng bản `stockLedger` export từ `index.ts`; port tồn kho của `order`, `product`, `product-import` giờ là `IStockLedger`. `changeStock` vẫn export dạng hàm cho `stock.test.ts` (test gọi thẳng sổ tồn, theo ngoại lệ của CODING_STANDARDS); test chỉ đổi import.
- `stock-receipt`: phân hàng về cho đơn đặt trước qua port, giờ nối vào `preorderApi`.
- `preorder-campaign` (0e1699f): 8 file `preorders/*` chuyển nguyên bằng git mv vào module (`preorder-arrival.ts`, `preorder-check.ts`, `preorder-deadline.ts`, `preorder-delivery.ts`, `preorder-remainder.ts`, `preorder-unsupplied.ts`, `preorder-campaign.admin.ts`, `preorder-campaign.query.ts`), giữ thân hàm và truy vấn trong các file đó; lớp HTTP (route, controller, service, repository, mapper) viết theo khuôn. **Chưa đưa hết truy vấn của 8 file vào repository**: các hàm đó nhận `tx` của module khác (receipts, hủy đã nhận tiền, job), tách tiếp làm diff lớn mà không thêm khóa hay bất biến nào; làm khi cần sửa chúng.
- `IPreorderApi` gom phần module khác dùng; `index.ts` export thêm `checkPreorder`, `processRemainderDeadlines`, `usedAllocations` cho code cũ và test job (test chỉ đổi import).
- `routes/preorders.ts` (khách đặt trước) để lại cho ticket 06, cùng luồng đặt đơn.
- Lỗi import vòng (d10084c): `order.module` nạp `preorder-campaign`, các file của nó đọc hằng của `order` khi nạp. `order/index.ts` export các file lá trước, `order.module.ts` sau cùng (ES modules đánh giá re-export theo thứ tự). Kiểm bằng cách nạp app từ từng `index.ts` mà test dùng.
- Thư mục `stock/`, `preorders/` không còn. Bộ test api (cần Docker) chạy trên CI.
