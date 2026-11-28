# 10: Dọn dẹp và ghi quy ước

**What to build:**
- Không còn code theo kiểu cũ; quy ước mới nằm trong tài liệu.

**Blocked by:** 04, 05, 06, 07, 08, 09

**Status:** ready-for-agent

- [ ] `api/src` chỉ còn `app.ts`, `server.ts`, `core/`, `modules/`, `generated/`, `cli/`; không còn `routes/` và các thư mục miền cũ; không còn adapter tạm.
- [ ] `CODING_STANDARDS.md`: mục mới "Module" (cấu trúc, tám quy tắc của spec, cách dùng `gen:module`); sửa các đoạn nhắc tới đường dẫn cũ.
- [ ] `README.md`, `docs/agents/*`: sửa đường dẫn cũ nếu có.
- [ ] Typecheck, lint, bộ test api (CI), `pnpm smoke` và E2E xanh mà không sửa test.

Spec: `docs/specs/kien-truc-module-nhieu-lop/spec.md`.
