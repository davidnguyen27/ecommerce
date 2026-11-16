# 01: Hàm tính giảm

**What to build:**
- Một module thuần (không đụng DB, không đụng HTTP) nhận các dòng đơn, mã giảm giá và phạm vi đã nạp, trả về tiền giảm của đơn và tiền giảm từng dòng, hoặc lý do mã không áp được vì tiền hàng hay sản phẩm. Ticket 03 và 04 gọi module này; báo giá và tạo đơn dùng chung một hàm nên không bao giờ tính lệch nhau.

**Blocked by:** —

**Status:** ready-for-agent

- [ ] Đầu vào: các dòng (variant id, thương hiệu, danh mục cùng chuỗi tổ tiên, giá, số lượng), mã (loại `fixed`/`percent`, giá trị, mức tối đa, đơn tối thiểu, danh sách thương hiệu, danh sách danh mục). Đầu ra: `{ discount, lines: [{ variantId, discount }] }` hoặc `{ reason: 'not_applicable' | 'below_minimum', shortfall? }`
- [ ] Dòng thuộc phạm vi khi thương hiệu nằm trong danh sách (nếu có) **và** danh mục là một danh mục trong danh sách hoặc con cháu của nó (nếu có). Cả hai danh sách trống là toàn bộ
- [ ] Các bước đúng thứ tự của spec mục "Tính giảm": tiền hàng thuộc phạm vi → đơn tối thiểu → tiền giảm (`percent` làm tròn xuống 1.000 VND, rồi lấy min với mức tối đa) → trần 50% tiền hàng thuộc phạm vi (làm tròn xuống 1.000) → chia xuống dòng theo tỷ lệ, làm tròn xuống tới đồng, phần lẻ dồn vào dòng có tiền hàng lớn nhất (bằng nhau thì dòng đầu)
- [ ] Mọi số tiền là `bigint` VND như cột `subtotal` hiện có
- [ ] Unit test (Vitest, không cần DB): `fixed`, `percent`; làm tròn; mức tối đa; trần 50% cho cả `fixed` lớn hơn trần; đơn tối thiểu chỉ tính tiền hàng thuộc phạm vi; phạm vi theo thương hiệu, theo danh mục cha khi dòng thuộc danh mục cháu, và cả hai cùng lúc; không dòng nào thuộc phạm vi; tổng tiền giảm các dòng luôn bằng tiền giảm của đơn (thêm vài trường hợp sinh ngẫu nhiên); dòng ngoài phạm vi có tiền giảm 0

Spec: mục "Tính giảm".
