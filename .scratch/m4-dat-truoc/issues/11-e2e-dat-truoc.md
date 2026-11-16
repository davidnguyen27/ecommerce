# 11: E2E Playwright luồng đặt trước

**What to build:**
- Một kịch bản Playwright chạy trên stack của `pnpm smoke --keep` với cổng giả lập, đi trọn vòng đời của một đơn đặt trước qua giao diện thật.

**Blocked by:** 10

**Status:** resolved

- [x] Kịch bản: nhân viên mở đợt cho biến thể hết hàng → khách thấy "Đặt trước", đặt 2 cái, giả lập trả cọc → kho ghi phiếu nhập 1 cái (xem trước báo giữ 1), rồi thêm 2 cái (giữ 1, dư 1 thành hàng sẵn) → khách trả phần còn lại → kho soạn, bàn giao, đã giao
- [x] Ở từng bước kiểm tra: tồn, đang giữ, sổ xuất nhập, ba trạng thái của đơn, và tình trạng biến thể khách thấy
- [x] Chạy được trong CI cùng E2E của M3

Spec: mục "Testing Decisions".

**Quyết định khi triển khai (2026-11-16):**
- `e2e/tests/preorder.spec.ts` dùng biến thể seed `AM90-TRANG-41` (hết hàng, 3.200.000). Kịch bản:
  1. chủ cửa hàng đăng nhập form admin và mở đợt qua `/admin/preorders/new` (cọc 30%, giao 10–20/12/2026, 5 suất);
  2. khách thấy "Đặt trước" kèm mức cọc ở trang sản phẩm, đặt 2 đôi ở `/dat-truoc/…` (bảng tiền: cọc, còn lại), trả cọc qua cổng giả lập;
  3. kho ghi phiếu nhập 1 đôi (xem trước "1 cho 1 đơn · 0 thành hàng sẵn"), rồi 2 đôi (xem trước "1 cho 1 đơn (1 đơn về đủ) · 1 thành hàng sẵn");
  4. khách trả phần còn lại bằng nút trên trang đơn;
  5. kho soạn, bàn giao, đánh dấu đã giao.
  Sau mỗi bước, test kiểm tồn và số đang giữ, sổ xuất nhập (receipt, rồi sale −2), ba trạng thái và giao dịch theo mục đích của đơn, và tình trạng biến thể khách thấy (`out_of_stock` → `preorder` → `in_stock`).
- Chạy lại được trên cùng stack: đầu và cuối kịch bản, `resetVariant` đóng các đợt đang mở của sản phẩm và kiểm kê biến thể về hết hàng. Nếu stack còn đơn đặt trước đã cọc từ một lượt dừng giữa chừng (M4 không hủy được đơn đó), test dừng ngay và báo dựng lại stack, vì hàng nhập về sẽ chia cho đơn đó trước.
- Trang sản phẩm được cache theo URL tới 60 giây (ADR 0006), và smoke đã mở `?sku=AM90-TRANG-41` lúc biến thể còn hết hàng. HTML cache còn nút "Thêm vào giỏ"; trình duyệt vẽ lại đúng nội dung đặt trước, nhưng các thuộc tính (`data-testid`) vẫn là của HTML cũ. Test thêm `&e2e=<runId>` vào URL để đọc trang dựng sau khi mở đợt. Khách thật cũng có thể thấy nội dung cũ tới 60 giây, đúng như ADR 0006 đã chấp nhận.
- `e2e/support/global-setup.ts` tạo và xuất bản thêm trang chính sách đặt trước. Ô SKU của form phiếu nhập có thêm `aria-label="SKU"` để test chọn theo nhãn thay vì `data-testid`.
- Kết quả trên máy (stack `pnpm smoke --keep`, Edge qua `E2E_CHANNEL=msedge`): smoke đạt, cả ba kịch bản E2E qua (dashboard, mua hàng M3, đặt trước), và kịch bản đặt trước chạy lần hai trên cùng stack vẫn qua. CI chạy `pnpm e2e` sau smoke như M3, nên tự có kịch bản mới.
