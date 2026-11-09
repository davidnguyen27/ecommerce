# 02: Giỏ hàng

**What to build:**
- Khách thêm biến thể đang chọn vào giỏ từ trang sản phẩm, thấy số món ở header trên mọi trang, đổi số lượng hoặc bỏ dòng ở trang giỏ hàng.
- Giỏ hàng nằm ở localStorage và còn nguyên khi tải lại trang. Trang giỏ gọi `quote` để hiện giá hiện tại và báo dòng nào đã đổi giá, hết hàng hay ngừng bán.

**Blocked by:** 01 (Phí giao theo tỉnh/thành)

**Status:** resolved

- [x] Composable giỏ hàng trên web lưu variant id, số lượng và giá lúc thêm vào localStorage. Mọi lần đọc và ghi bọc try/catch; localStorage hỏng hoặc không dùng được thì coi như giỏ rỗng
- [x] Nút "Thêm vào giỏ" ở trang sản phẩm theo biến thể đang chọn, khóa khi hết hàng hoặc ngừng bán. Tối đa 5 cái mỗi biến thể; đã đủ 5 thì nút báo rõ giới hạn
- [x] Biểu tượng giỏ có số món ở header của layout khách. Số món render phía client để không lệch SSR
- [x] Trang `/gio-hang`:
  - danh sách dòng, đổi số lượng 1–5, bỏ dòng;
  - gọi `quote` và hiện thay đổi theo dòng (giá mới, hết hàng, ngừng bán);
  - tổng tiền hàng, nút sang trang đặt mua (trang này làm ở ticket 03);
  - `noindex`, không SSR dữ liệu giỏ.
- [x] `scripts/smoke.ts` kiểm `/gio-hang` trả 200 và có `noindex`
- [x] Logic thuần của giỏ (cộng dồn cùng biến thể, chặn quá 5, đọc localStorage hỏng) tách thành hàm thuần và có test. Phần giao diện do E2E (ticket 14) phủ

**Quyết định khi triển khai (2026-11-02):**
- `PublicProduct.variants[]` có thêm `id` (id biến thể trong phiên bản đang xuất bản). Giỏ lưu theo id này. Test `product-publishing` kiểm `id`.
- Logic thuần ở `web/app/utils/cart.ts` (Nuxt tự import):
  - kiểu `SavedCartLine` (`variantId`, `quantity`, `price` là giá khách thấy lúc thêm);
  - `readCart(raw)`: dùng `CartLines` của shared và kiểm giá; hỏng hay sai dạng thì trả giỏ rỗng;
  - `addToCart` cộng dồn và lấy giá vừa thấy; trả `{ ok: false, reason: 'limit' | 'full' }` khi biến thể đã đủ 5 hoặc giỏ đã đủ `MAX_CART_LINES` dòng;
  - `setQuantity` kẹp 1–5, `removeLine`, `cartCount`;
  - `cartChanges(lines, quote.lines)` trả `Map<variantId, { kind: 'price', from, to } | { kind: 'discontinued' } | { kind: 'out_of_stock' }>`;
  - `acceptQuotedPrices(lines, quote.lines)` lưu giá hiện tại làm giá đã thấy.
- Ticket 03 dùng lại `cartChanges`, `acceptQuotedPrices` và giá trong `SavedCartLine` để gửi "giá khách đã thấy".
- Bộ chạy test: thêm vitest vào `web` (`web/vitest.config.ts`, chỉ `web/test/**/*.test.ts`, không dựng môi trường Nuxt; `pnpm --filter @ecommerce/web test`). CI chạy bước này trong job `lint`. Không thêm vào shared vì logic giỏ là của web.
- Composable `useCart()` (`web/app/composables/useCart.ts`): state `useState('cart')`, khóa localStorage `cart`. Giỏ chỉ nạp ở `onMounted`, nên SSR và lúc hydrate đều thấy giỏ rỗng và `ready = false`. Cờ `ready` dùng để khóa nút và ẩn số món cho tới khi nạp xong. Giỏ đổi ở tab khác thì cập nhật theo sự kiện `storage`.
- Trang sản phẩm: nút "Thêm vào giỏ" (`data-testid="add-to-cart"`) khóa khi hết hàng (nhãn "Hết hàng") hoặc khi đã có 5 cái (nhãn "Đã có 5 cái trong giỏ, tối đa 5 cái"). Trước khi giỏ nạp xong, nút cũng khóa. Biến thể ngừng bán không có trong `variants`, nên không cần khóa riêng.
- Header: link `/gio-hang` có biểu tượng giỏ. Số món (`data-testid="cart-count"`) là tổng số cái, chỉ hiện khi giỏ đã nạp và khác 0.
- Trang `/gio-hang`:
  - gọi `quote` không kèm `provinceCode` mỗi khi giỏ đổi, chỉ nhận kết quả của lần gọi cuối;
  - mỗi dòng hiện giá hiện tại; dòng đổi giá hiện giá cũ và giá mới, kèm nút chung "Đồng ý giá mới";
  - không hiện phí giao; có gợi ý "mua thêm X để được miễn phí giao" khi có ngưỡng, và lưu ý khi giỏ có món chỉ giao đường bộ;
  - nút "Đặt mua" link tới `/dat-mua` (ticket 03 làm trang này). Nút chỉ bật khi không còn dòng đổi giá, ngừng bán hay hết hàng. Đây là lựa chọn thận trọng theo user story 12.
- Thuộc tính biến thể ở trang giỏ hiện bằng giá trị nối bởi " · ", không kèm đơn vị, vì `QuoteLine` không có schema thuộc tính.
- Smoke kiểm thêm:
  - `/gio-hang`: 200, `<h1>Giỏ hàng</h1>`, "Đang tải", `noindex`;
  - trang chủ có `href="/gio-hang"`;
  - trang sản phẩm có nút thêm vào giỏ.
- Đã xem SSR của `/gio-hang` bằng `nuxt dev` (khung trang, `noindex`, link giỏ ở header). Chưa thử luồng thêm vào giỏ bằng trình duyệt; ticket 14 phủ phần này.
- Cần chủ doanh nghiệp xác nhận: chặn "Đặt mua" ở trang giỏ khi có dòng ngừng bán, hết hàng hoặc giá đổi chưa đồng ý. Khách phải bỏ dòng hoặc đồng ý giá trước.

**Sửa sau code review toàn nhánh (xem `implement-spec/review-fixes.md`):**
- `inStock` của báo giá nay theo số lượng khách muốn mua, nên trang giỏ báo thiếu hàng ngay khi tăng số lượng. Nhãn đổi thành "Không đủ hàng, hãy giảm số lượng hoặc bỏ khỏi giỏ", vì không lộ số tồn nên không phân biệt hết hẳn với không đủ. Quyết định chặn "Đặt mua" ở trên áp dụng cho cả dòng không đủ hàng.
