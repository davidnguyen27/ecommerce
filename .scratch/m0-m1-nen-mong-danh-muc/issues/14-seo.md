# 14: SEO

**What to build:** Trang sản phẩm, trang danh mục, trang thương hiệu và trang nội dung được máy tìm kiếm đọc tốt:
- render SSR, có thẻ meta và canonical đúng;
- cache ngắn bằng `routeRules` cho trang danh mục và trang sản phẩm;
- sitemap sinh từ sản phẩm, danh mục, thương hiệu và trang nội dung đã xuất bản;
- dữ liệu cấu trúc schema.org Product/Offer trên trang sản phẩm.

**Blocked by:** 11 (Xuất bản, lưu trữ và trang chi tiết sản phẩm), 12 (Tìm kiếm, bộ lọc, facets, sắp xếp)

**Status:** ready-for-agent

- [ ] Mỗi trang công khai có title, description, canonical và Open Graph. Trang biến thể (URL có SKU) có canonical trỏ về trang sản phẩm
- [ ] Trang kết quả tìm kiếm và các URL có bộ lọc được đánh `noindex`, để tránh nội dung trùng lặp
- [ ] `routeRules` cache ngắn cho trang danh mục và trang sản phẩm. `/admin/**` không bị cache và không được index
- [ ] Sitemap chỉ chứa nội dung đã xuất bản và cập nhật khi xuất bản hoặc lưu trữ. Có robots.txt chặn `/admin` và `/api`
- [ ] Trang sản phẩm có dữ liệu cấu trúc Product/Offer với giá VND (khoảng giá nếu có nhiều biến thể), thương hiệu và ảnh. Chưa khai báo `availability` (sẽ thêm ở M2)
- [ ] Có test qua HTTP cho các trường hợp:
  - sitemap chỉ chứa nội dung đã xuất bản;
  - dữ liệu cấu trúc lấy đúng giá của biến thể đang bán, nếu dữ liệu này được dựng phía API
