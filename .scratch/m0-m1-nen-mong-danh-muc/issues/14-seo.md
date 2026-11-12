# 14: SEO

**What to build:** Trang sản phẩm, trang danh mục, trang thương hiệu và trang nội dung được máy tìm kiếm đọc tốt:
- render SSR, có thẻ meta và canonical đúng;
- cache ngắn bằng `routeRules` cho trang danh mục và trang sản phẩm;
- sitemap sinh từ sản phẩm, danh mục, thương hiệu và trang nội dung đã xuất bản;
- dữ liệu cấu trúc schema.org Product/Offer trên trang sản phẩm.

**Blocked by:** 11 (Xuất bản, lưu trữ và trang chi tiết sản phẩm), 12 (Tìm kiếm, bộ lọc, facets, sắp xếp)

**Status:** resolved

- [x] Mỗi trang công khai có title, description, canonical và Open Graph. Trang biến thể (URL có SKU) có canonical trỏ về trang sản phẩm
- [x] Trang kết quả tìm kiếm và các URL có bộ lọc được đánh `noindex`, để tránh nội dung trùng lặp
- [x] `routeRules` cache ngắn cho trang danh mục và trang sản phẩm. `/admin/**` không bị cache và không được index
- [x] Sitemap chỉ chứa nội dung đã xuất bản và cập nhật khi xuất bản hoặc lưu trữ. Có robots.txt chặn `/admin` và `/api`
- [x] Trang sản phẩm có dữ liệu cấu trúc Product/Offer với giá VND (khoảng giá nếu có nhiều biến thể), thương hiệu và ảnh. Chưa khai báo `availability` (sẽ thêm ở M2)
- [x] Có test qua HTTP cho các trường hợp:
  - sitemap chỉ chứa nội dung đã xuất bản;
  - dữ liệu cấu trúc lấy đúng giá của biến thể đang bán, nếu dữ liệu này được dựng phía API

**Quyết định khi triển khai (2026-10-23):**
- URL tuyệt đối dựng từ `runtimeConfig.public.siteUrl` (`NUXT_PUBLIC_SITE_URL`; docker compose lấy theo `SITE_URL` như API). Composable `useSeo({ title, description, canonicalPath?, image?, noindex? })` (`web/app/composables/useSeo.ts`) đặt title, description, canonical, `og:title|description|url|type|image` và `robots`; mọi trang khách dùng nó. Canonical mặc định là đường dẫn bỏ query.
- Canonical/noindex: trang sản phẩm và mọi biến thể `?sku=` canonical về `/san-pham/<slug>`. `/tim-kiem` luôn `noindex, follow`. Trang danh mục, thương hiệu có tìm kiếm, bộ lọc hoặc sắp xếp (`q, type, minPrice, maxPrice, sort, attr.*`; `isFilteredListing` trong `web/app/utils/seo.ts`, dùng chung danh sách tham số với `ProductSearch`) thì `noindex, follow` và canonical về trang gốc; chỉ phân trang `?trang=N` thì vẫn index, canonical giữ `?trang=N`. Các trang tài khoản khách (đăng nhập, đăng ký, …) `noindex`.
- Mô tả: sản phẩm lấy mô tả trong snapshot (cắt 160 ký tự), không có thì "<tên> của <thương hiệu>, giá từ <giá>"; trang nội dung lấy chữ thuần của markdown (`markdownText`); thương hiệu lấy mô tả; danh mục dựng từ tên và nhóm hàng.
- `routeRules`: `/san-pham/**`, `/danh-muc/**` là `swr: 60` (cache ở server Nuxt, khóa gồm cả query, không cache trang lỗi), nên xuất bản/lưu trữ hiện ra trên các trang này chậm nhất khoảng 60 giây. `/admin/**`: `cache-control: no-store`, `x-robots-tag: noindex, nofollow`.
- Sitemap: API công khai `GET /api/sitemap` (`Sitemap { entries: { path, lastModified }[] }` trong shared; route `api/src/routes/public-sitemap.ts`): sản phẩm theo slug của phiên bản đang xuất bản (`lastModified` = lúc xuất bản), danh mục khách thấy (cùng quy tắc ẩn cả nhánh như trang danh mục), thương hiệu đang hiển thị, trang nội dung đã xuất bản. Đọc mỗi lần gọi nên đổi ngay khi xuất bản hoặc lưu trữ. Website: server route `/sitemap.xml` (thêm `/`, `/thuong-hieu`) và `/robots.txt` (chặn `/admin`, `/api`, trỏ tới sitemap) trong `web/server/routes/`. Không thêm quyền.
- Dữ liệu cấu trúc dựng ở web (`productJsonLd`) từ `PublicProduct`, vốn đã lấy từ snapshot: `Product` với `brand`, `image` (ảnh gốc), `mpn` (mã mẫu), `offers` là `Offer` khi một biến thể, `AggregateOffer` (`lowPrice`, `highPrice`, `offerCount`, VND) khi nhiều biến thể. Không có `availability`. Vì không dựng phía API nên kiểm bằng smoke thay cho test HTTP.
- Mục mở từ ticket 11 (chuyển hướng slug cũ): `GET /api/products/:slug` với slug mà một sản phẩm đang xuất bản từng dùng thì trả sản phẩm đó kèm slug hiện tại; slug đang có sản phẩm dùng thì ưu tiên sản phẩm đó; sản phẩm đã lưu trữ thì 404. Trang `/san-pham/[slug]` chuyển hướng 301 sang slug hiện tại (giữ query). Đổi slug danh mục, thương hiệu chưa có chuyển hướng (không lưu lịch sử slug).
- `scripts/smoke.ts`: thêm kiểm canonical, Open Graph, description, `noindex`, JSON-LD, header cache, `/sitemap.xml`, `/robots.txt`, header của `/admin`. Chưa có kiểm smoke cho chuyển hướng 301 slug cũ (phía API có test HTTP).
- Còn mở: chưa có tên website (`og:site_name`) và ảnh Open Graph mặc định cho trang không có ảnh; trang chủ vẫn là trang trạng thái hệ thống.
