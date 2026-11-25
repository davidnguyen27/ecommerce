# 03: Khách thấy "Đang nhận đặt trước"

**What to build:**
- Biến thể hết hàng sẵn nhưng thuộc đợt đang mở và còn suất hiện "Đặt trước" kèm mức cọc và thời gian giao dự kiến. Thẻ sản phẩm có nhãn "Đặt trước". Biến thể còn hàng sẵn không bao giờ hiện đặt trước.

**Blocked by:** 02

**Status:** resolved

- [x] API sản phẩm trả tình trạng từng biến thể: `in_stock` | `preorder` (kèm id đợt, tỷ lệ cọc, thời gian giao dự kiến) | `out_of_stock`. Không trả số lượng hay số suất. Điều kiện của `preorder` theo đúng spec: đã xuất bản, có trong phiên bản đang xuất bản, không ngừng bán, `on_hand - reserved = 0`, đợt đang mở, số đã dùng < suất
- [x] Thẻ sản phẩm và kết quả tìm kiếm có cờ đặt trước khi không còn biến thể nào còn hàng sẵn nhưng có ít nhất một biến thể `preorder`. Bộ lọc "còn hàng" và sắp xếp "còn hàng trước" không đổi (chỉ tính hàng sẵn)
- [x] JSON-LD `availability`: `InStock`, `PreOrder`, `OutOfStock`
- [x] Trang sản phẩm: biến thể `preorder` có nhãn và nút "Đặt trước" thay cho "Thêm vào giỏ". Nút dẫn tới `/dat-truoc/<variantId>` (trang này làm ở ticket 04, tạm thời hiện thông báo chưa mở)
- [x] Test qua HTTP: còn hàng sẵn thì `in_stock` dù có đợt; hết suất, đợt đóng tay, quá hạn đóng, ngừng bán, sản phẩm lưu trữ thì `out_of_stock`; cờ thẻ sản phẩm và JSON-LD đúng; bộ lọc còn hàng loại hàng đặt trước

Spec: mục "Hiển thị cho khách".

**Quyết định khi triển khai (2026-11-15):**
- `PublicProduct.variants[]` giữ `inStock` (giỏ hàng, đặt mua và trang sản phẩm đang dùng), thêm `availability` (`VariantAvailability`) và `preorder` (`PreorderOffer` gồm `campaignId`, `depositPercent`, `deliveryFrom`, `deliveryTo`, hoặc `null`). `ProductCard` thêm `preorder: boolean`, chỉ `true` khi `inStock` là `false`. Hai schema mới nằm trong `shared/src/products.ts`, không nằm trong `preorders.ts`, vì `preorders.ts` đã import từ `products.ts`.
- `preorderOffers(db, variantIds, now)` (`api/src/preorders/campaigns.ts`) là một câu SQL, dùng chung cho trang sản phẩm và danh sách. Nó đọc trạng thái **hiện tại** của biến thể và sản phẩm, không đọc snapshot, giống `inStockIds` và như kiểm ngừng bán lúc đặt mua M3. Vì vậy biến thể ngừng bán sau khi xuất bản thôi đặt trước ngay, không cần xuất bản lại. Điều kiện hết hàng viết là `on_hand - reserved <= 0`. Ngoài ra route ép thêm: biến thể còn hàng sẵn thì `preorder = null`.
- Không có bộ lọc "còn hàng" riêng; chỉ có sắp xếp còn hàng trước trong `search.ts`, và nó vẫn chỉ xét `on_hand - reserved > 0`, nên không phải sửa gì. Test kiểm rằng sản phẩm chỉ đặt trước được xếp sau sản phẩm còn hàng, kể cả khi sắp theo giá giảm dần.
- Sản phẩm lưu trữ không còn trang (404) và không còn thẻ, nên câu "lưu trữ thì `out_of_stock`" được kiểm qua việc sản phẩm biến mất.
- Web:
  - trang sản phẩm có nhãn tình trạng ba giá trị; chip biến thể ghi "Đặt trước" hay "Hết hàng" và chỉ làm mờ chip hết hàng; mặc định chọn biến thể còn hàng, rồi tới biến thể đặt trước được;
  - biến thể đặt trước được có khối "Cọc X% … Giao dự kiến …" và nút "Đặt trước" (`data-testid="preorder-button"`) dẫn tới `/dat-truoc/<variantId>`, thay cho nút "Thêm vào giỏ";
  - thẻ sản phẩm ghi "Đặt trước" thay cho "Hết hàng" khi `preorder`;
  - JSON-LD: có hàng sẵn là `InStock`, không thì có biến thể đặt trước được là `PreOrder`, còn lại `OutOfStock` (`web/test/seo.test.ts`);
  - trang chờ `/dat-truoc/[variantId]` (`noindex`) báo "sắp mở"; ticket 04 thay bằng form. `scripts/smoke.ts` có thêm dòng kiểm tra trang này.
- Test: `api/test/preorder-availability.test.ts` (9 test). `product-publishing.test.ts` so khớp tuyệt đối thẻ sản phẩm nên phải thêm `preorder: false` vào kỳ vọng; đây là trường mới, không phải hành vi đổi. Toàn bộ bộ test API (43 file, 477 test) và test web (12) qua.
- **Chưa chạy `pnpm smoke` và chưa xem bằng trình duyệt.** Typecheck của Nuxt qua.
