# Coding standards

Reviewer đọc file này khi chạy `/code-review`. Chỉ ghi các judgement call; những gì lint, Prettier, typecheck và test đã bắt thì không lặp lại ở đây. Thuật ngữ theo `GLOSSARY.md`, quyết định kiến trúc theo `docs/adr/`.

## Dữ liệu công khai

- **Snapshot đã xuất bản:** endpoint cho khách chỉ đọc từ bản đã xuất bản (ví dụ `content_page_version`), không đọc trường nào của bản đang soạn, kể cả trường phụ như loại hay slug. Trường nào khách thấy mà sửa được trong bản nháp thì hoặc chép vào snapshot, hoặc cố định từ lúc tạo. Áp dụng cho trang nội dung và cho sản phẩm (ticket 11).
- Thứ cần giữ làm bằng chứng (audit log, phiên bản đã xuất bản) là append-only, chặn bằng trigger trong migration chứ không chỉ bằng việc API thiếu endpoint sửa.

## Ghi dữ liệu ở API quản trị

- Mọi thao tác ghi đi qua `audited()` (ADR 0003). `before`/`after` chứa trường nghiệp vụ của đối tượng, không chứa mật khẩu, hash hay token.
- Thao tác không làm thay đổi gì thì không ghi gì: không bản ghi audit, không tác dụng phụ (thu hồi phiên, tạo phiên bản), và trả trạng thái hiện tại với 200.
- Bất biến trải trên nhiều dòng (còn ít nhất một owner, số phiên bản tăng dần) được giữ bằng khóa trong chính transaction đó (`FOR UPDATE` hoặc `pg_advisory_xact_lock`), không dựa vào việc kiểm tra trước rồi mới ghi.
- Router khai báo quyền bằng `requirePermission` (ADR 0002). Quyền mới hoặc việc dùng một quyền có sẵn cho chức năng mới thì ghi vào phần quyết định của ticket.

## Hợp đồng API

- Input đi qua `parse(Schema, …)` với schema trong `@ecommerce/shared`; body trả về được gán kiểu bằng schema đó (`const body: X = …; res.json(body)`).
- Lỗi có chủ đích ném `AppError` với một `ErrorCode`; lỗi theo từng trường kèm `fields`.

## Test

- Test đi qua HTTP (supertest trên Postgres thật). `prisma` trong test chỉ dùng để dựng trạng thái ban đầu, không dùng để kiểm kết quả.
- Tên test mô tả hành vi bằng tiếng Việt, đọc như một dòng đặc tả.

## Web

- Trang khách render SSR, gọi API qua `useAsyncData` với `apiBase`, và parse response bằng schema shared. Trang `/admin/**` là SPA, gọi API qua `useAdminSession().adminFetch`.
- Thay đổi làm đổi HTML khách nhận (layout, chân trang, trang mới) thì thêm hoặc sửa kiểm tra tương ứng trong `scripts/smoke.ts`.

## Comment

- Comment tiếng Việt, nói lý do hoặc ràng buộc không nhìn thấy từ code, thường một dòng. Mật độ theo các file lân cận.
