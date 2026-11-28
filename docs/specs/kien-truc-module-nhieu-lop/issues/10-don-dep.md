# 10: Dọn dẹp và ghi quy ước

**What to build:**
- Không còn code theo kiểu cũ; quy ước mới nằm trong tài liệu.

**Blocked by:** 04, 05, 06, 07, 08, 09

**Status:** resolved

- [x] `api/src` chỉ còn `app.ts`, `server.ts`, `core/`, `modules/`, `generated/`, `cli/`; không còn `routes/` và các thư mục miền cũ; không còn adapter tạm.
- [x] `CODING_STANDARDS.md`: mục mới "Module" (cấu trúc, tám quy tắc của spec, cách dùng `gen:module`); sửa các đoạn nhắc tới đường dẫn cũ.
- [x] `README.md`, `docs/agents/*`: sửa đường dẫn cũ nếu có.
- [x] Typecheck, lint, bộ test api (CI), `pnpm smoke` và E2E xanh mà không sửa test.

Spec: `docs/specs/kien-truc-module-nhieu-lop/spec.md`.

**Quyết định khi triển khai (2026-11-28):**
- `api/src` có thêm `jobs/` ngoài danh sách ở trên. Worker pg-boss (`jobs/worker.ts`, trước là `core/jobs/jobs.ts`) và việc dọn dữ liệu hết hạn (`jobs/cleanup.ts`) gọi hàm của module đơn hàng, đặt trước, hỗ trợ, chatbot, nên không thể nằm trong `core/`. Chúng là điểm lắp ráp như `server.ts`. Kiểu hàng đợi mà module dùng (`CustomerMail`, `EmailQueue`, `OrderExpiryQueue`) ở `core/jobs/queues.ts`.
- ESLint thêm luật: `core/` không import `modules/`.
- Adapter tạm đã gỡ: `createProductQuery`, `createOrderQuery`, `categoryQuery`, `attributeSchemaQuery`. Công cụ chatbot và import sản phẩm nhận query của module sản phẩm và schema qua constructor.
- Giữ lại và ghi thành quy ước (CODING_STANDARDS "Module"): hàm và đối tượng không trạng thái export từ `index.ts` cho file nghiệp vụ gọi trong transaction của module khác (`stockLedger`, `preorderApi`, `cartVariants`, hàm ghi tiền và hoàn tiền); `createOrderService` cho worker, `expireOverdueOrders` cho worker và test.
- Comment "chưa chuyển / gỡ khi…" đã sửa hết. README và `docs/agents/*` không nhắc đường dẫn cũ; spec và ADR cũ giữ nguyên vì là lịch sử.
- Test chỉ đổi đường dẫn import (`Jobs`, `deleteExpiredRecords`).
