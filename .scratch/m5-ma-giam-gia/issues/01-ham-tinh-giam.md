# 01: Hàm tính giảm

**What to build:**
- Một module thuần (không đụng DB, không đụng HTTP) nhận các dòng đơn, mã giảm giá và phạm vi đã nạp, trả về tiền giảm của đơn và tiền giảm từng dòng, hoặc lý do mã không áp được vì tiền hàng hay sản phẩm. Ticket 03 và 04 gọi module này; báo giá và tạo đơn dùng chung một hàm nên không bao giờ tính lệch nhau.

**Blocked by:** —

**Status:** resolved

- [x] Đầu vào: các dòng (variant id, thương hiệu, danh mục cùng chuỗi tổ tiên, giá, số lượng), mã (loại `fixed`/`percent`, giá trị, mức tối đa, đơn tối thiểu, danh sách thương hiệu, danh sách danh mục). Đầu ra: `{ discount, lines: [{ variantId, discount }] }` hoặc `{ reason: 'not_applicable' | 'below_minimum', shortfall? }`
- [x] Dòng thuộc phạm vi khi thương hiệu nằm trong danh sách (nếu có) **và** danh mục là một danh mục trong danh sách hoặc con cháu của nó (nếu có). Cả hai danh sách trống là toàn bộ
- [x] Các bước đúng thứ tự của spec mục "Tính giảm": tiền hàng thuộc phạm vi → đơn tối thiểu → tiền giảm (`percent` làm tròn xuống 1.000 VND, rồi lấy min với mức tối đa) → trần 50% tiền hàng thuộc phạm vi (làm tròn xuống 1.000) → chia xuống dòng theo tỷ lệ, làm tròn xuống tới đồng, phần lẻ dồn vào dòng có tiền hàng lớn nhất (bằng nhau thì dòng đầu)
- [x] Mọi số tiền là `bigint` VND như cột `subtotal` hiện có
- [x] Unit test (Vitest, không cần DB): `fixed`, `percent`; làm tròn; mức tối đa; trần 50% cho cả `fixed` lớn hơn trần; đơn tối thiểu chỉ tính tiền hàng thuộc phạm vi; phạm vi theo thương hiệu, theo danh mục cha khi dòng thuộc danh mục cháu, và cả hai cùng lúc; không dòng nào thuộc phạm vi; tổng tiền giảm các dòng luôn bằng tiền giảm của đơn (thêm vài trường hợp sinh ngẫu nhiên); dòng ngoài phạm vi có tiền giảm 0

Spec: mục "Tính giảm".

**Quyết định khi triển khai (2026-11-16):**
- `api/src/vouchers/discount.ts`: `computeDiscount(lines, rule)` và `inScope(line, rule)`. `DiscountRule` là union theo `kind` (`fixed` có `amount`; `percent` có `percent` và `maxDiscount`) cộng đơn tối thiểu và hai danh sách phạm vi. Kết quả là `{ ok: true, discount, lines }` hoặc `{ ok: false, reason }`; `below_minimum` kèm `shortfall`.
- Nơi gọi truyền `categoryPath` gồm danh mục của sản phẩm và mọi tổ tiên; module không đọc cây danh mục. Thời hạn, trạng thái tắt, hình thức bán và lượt do nơi gọi kiểm (ticket 03).
- `lines` trả về đủ mọi dòng theo đúng thứ tự đầu vào; dòng ngoài phạm vi có tiền giảm 0. Giả định mỗi biến thể xuất hiện một lần, như giỏ hàng.
- Tiền giảm có thể bằng 0 khi tỷ lệ rất nhỏ trên tiền hàng nhỏ (dưới 1.000 sau làm tròn); vẫn coi là áp được, vì check `discount >= 0` cho phép.
- Test `api/test/voucher-discount.test.ts` gọi thẳng hàm (ngoại lệ trong CODING_STANDARDS, có comment ở đầu file); vẫn chạy qua globalSetup của api nên cần Docker. Gồm 500 vòng sinh ngẫu nhiên có hạt giống cố định, kiểm tổng các dòng bằng tiền giảm và không dòng nào âm.
