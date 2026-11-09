# 14: E2E mua hàng bằng Playwright

**What to build:**
- Một luồng E2E chạy bằng trình duyệt thật, trên stack của `pnpm smoke --keep`, với cổng giả lập:
  1. Khách thêm vào giỏ và đặt mua.
  2. Giả lập đã thanh toán.
  3. Nhân viên kho chuẩn bị, bàn giao, đánh dấu đã giao.

  Ở từng bước, kiểm tồn, số đang giữ, sổ xuất nhập và trạng thái đơn.
- Luồng chạy trong CI, thay cho mục "smoke admin" ghi ở ticket 15 của M0–M1.

**Blocked by:** 09 (Đã giao, giao thất bại và email giao hàng), 13 (CI trên GitHub Actions)

**Status:** resolved

- [x] Cài Playwright ở workspace phù hợp, chỉ dùng Chromium. Lệnh `pnpm e2e` chạy trên stack đã dựng
- [x] Viết kịch bản mua hàng như trên. Selector chọn theo vai trò hoặc nhãn (label đã được nối với ô nhập từ đợt retro); chỉ dùng `data-testid` khi không có cách khác
- [x] Thêm kịch bản admin nhỏ từ retro: đăng nhập bằng `warehouse` thì dashboard không hiện lối tắt danh mục (lệch, xem dưới)
- [x] Job E2E trong `ci.yml`, chạy sau smoke; giữ trace khi đỏ
- [x] Chạy xanh trên máy local

**Quyết định khi triển khai (2026-11-02):**
- Workspace mới `e2e/` (`@ecommerce/e2e`, thêm vào `pnpm-workspace.yaml`), `@playwright/test` 1.64.1 (ghim đúng bản), một project `chromium`. Root `pnpm e2e` = `pnpm --filter @ecommerce/e2e e2e`; `pnpm typecheck` gồm cả `e2e`. `E2E_BASE_URL` mặc định `http://localhost:8081` (stack của smoke). `E2E_CHANNEL=msedge` dùng Edge có sẵn trên máy thay cho Chromium tải về; máy này chạy local bằng Edge, chưa tải Chromium. CI cài `playwright install --with-deps chromium`.
- `workers: 1`, không retry, `trace: retain-on-failure`, screenshot khi đỏ. `test-results/`, `playwright-report/` vào `.gitignore` và ignore của eslint.
- `e2e/support/global-setup.ts` bổ sung dữ liệu mà seed của smoke không có, chạy lại được: `PUT /api/admin/shipping-fees` (mặc định 50.000, tỉnh 79 là 30.000); trang `chinh-sach-bao-mat` (`policy`) tạo và xuất bản nếu chưa có; nhân viên `kho-e2e@example.com` vai trò `warehouse` qua API nhân sự; kiểm kê `AM90-DEN-40` lên lại khi không còn cái nào bán được. Owner đăng nhập API một lần (`X-Client: mobile`), token truyền cho test qua biến môi trường `E2E_OWNER_ACCESS_TOKEN`, vì đăng nhập bị giới hạn 10 lần mỗi email trong 15 phút.
- `tests/purchase.spec.ts`: khách vãng lai (email, số điện thoại riêng mỗi lượt) thêm `AM90-DEN-40` vào giỏ, đặt mua ở tỉnh 79 (kiểm phí giao và tổng), sang cổng giả lập (kiểm số tiền), "Giả lập đã thanh toán", về trang đơn. Nhân viên kho đăng nhập bằng form trong context riêng: "Bắt đầu chuẩn bị", bàn giao (đơn vị, mã vận đơn), "Đã giao". Khách mở lại đơn thấy hoàn tất và mã vận đơn. Sau từng bước kiểm qua API quản trị: ba trạng thái của đơn, `onHand`/`reserved`, số dòng sổ của biến thể. Bàn giao kiểm dòng `sale` `-1` có `orderCode` và `onHandAfter`; đã thanh toán kiểm một giao dịch nguồn `simulator`. Tồn và sổ kiểm theo chênh lệch với lúc bắt đầu, nên chạy lại trên cùng stack được.
- Selector theo vai trò hoặc nhãn. `data-testid` chỉ cho giá trị trong `<dl>` (trạng thái đơn, phí giao, tổng, số tiền giả lập, mã vận đơn, khối bàn giao ở admin) và thẻ `dashboard-to-pick`. Ô tỉnh/thành, phường/xã chọn bằng `select[name=province]`, `select[name=ward]`.
- **Lệch so với ticket (kịch bản admin):** warehouse có `catalog.edit` là có chủ ý (người dùng đã chốt: kho được sửa sản phẩm, danh mục), nên dashboard **có** lối tắt "Cây Danh mục". `tests/admin-dashboard.spec.ts` kiểm điều retro muốn giữ, lối tắt đi theo quyền: kho thấy đúng ba lối tắt Sản phẩm, Thương hiệu, Cây danh mục; không thấy "Soạn Chính sách" (`content.edit`) và khối kiểm toán (`audit.view`); thấy thẻ "Đơn chờ soạn". Phần owner "sửa, lưu biến thể, xuất bản" của mục smoke admin M0–M1 không làm ở đây.
- CI: job `e2e` (`needs: smoke`) trên máy riêng: `pnpm install`, cài Chromium, `pnpm smoke --keep`, `pnpm e2e`; đỏ thì upload `e2e/test-results/` (trace) và `e2e/playwright-report/` thành artifact `playwright-trace`, giữ 7 ngày. Dựng lại stack thay vì gộp vào job smoke, để smoke đỏ thì không chạy E2E và lỗi tách rõ.
- `CODING_STANDARDS.md` mục Test thêm quy ước E2E (selector; dựng dữ liệu và kiểm kết quả qua API quản trị).
- Chạy xanh local trên stack mới dựng (Edge); chạy lại 4 lượt liên tiếp trên cùng stack vẫn xanh. Giới hạn 5 lần đặt mua mỗi IP mỗi giờ nên được khoảng 4 lượt mỗi giờ trên một stack. Chưa thấy lượt chạy trên GitHub.
- Phát hiện a11y (chưa sửa): nhãn bọc `<select>` ở `/dat-mua` lấy cả chữ của option, nên `getByLabel('Tỉnh/thành')` khớp cả ô phường/xã (option "Chọn tỉnh/thành trước"); tên đọc được của link giỏ là "Giỏ hàng , 1 món" (dấu cách thừa trước dấu phẩy). Không thấy lỗi chức năng nào trong luồng.
