# 09: Nhóm nội dung, báo cáo, chatbot

**What to build:**
- Trang nội dung, thông tin pháp lý, sitemap, báo cáo, chatbot, health check.

**Blocked by:** 02, 03

**Status:** resolved

- [x] Mỗi module (`content-page`, `legal-info`, `sitemap`, `report`, `chatbot`, `health`) có đủ các lớp theo spec, mục "Cấu trúc thư mục"; module khác chỉ import qua `index.ts`.
- [x] Code cũ của nhóm này (route trong `routes/`, file trong thư mục miền cũ) bị xóa; `app.ts`/`modules/index.ts` gắn module mới.
- [x] Chuyển trạng thái nào cũng khóa dòng; audit trong transaction; thông điệp lỗi, `fields`, nội dung audit giữ nguyên từng chữ.
- [x] Typecheck, lint, bộ test api (CI) và `pnpm smoke` xanh mà không sửa test.

Spec: `docs/specs/kien-truc-module-nhieu-lop/spec.md`.

**Quyết định khi triển khai (2026-11-28):**
- Cùng cách với ticket 05–08: file nghiệp vụ chuyển nguyên bằng git mv (`content/pages.ts` thành `content-page/content-page.query.ts`, `reports/*` thành `report/report-*.ts`, `chat/*` thành `chatbot/chatbot-*.ts`); lớp HTTP viết theo khuôn. Báo cáo không có repository: mỗi báo cáo là SQL riêng trong `report-*.ts`.
- Báo cáo chatbot (`reports/chatbot.ts`) thuộc module `chatbot`, gắn ở `/admin/reports/chatbot` trước module `report` như cũ.
- Sản phẩm đang xem trong chatbot đọc qua `ProductModule.query`. Công cụ của model (`chatbot-tools.ts`) vẫn dùng `createProductQuery` và các instance dùng chung, gỡ ở ticket 10.
- Sửa nháp trang nội dung nay khóa dòng `content_page` như đăng bản; lưu thông tin pháp lý khóa advisory như phí giao.
- `health` không nằm trong `createModules`: route `/healthz` gắn ở gốc, ngoài `/api`, như cũ.
- `/admin/me` chuyển vào module `auth`. `routes/` không còn; `app.ts` chỉ gắn module, thêm một chốt đăng nhập cho đường `/admin/…` không có module để vẫn trả 401 trước 404 như router `/admin` cũ.
- Test chỉ đổi đường dẫn import (các file test chatbot). Bộ test api (cần Docker) chạy trên CI.
