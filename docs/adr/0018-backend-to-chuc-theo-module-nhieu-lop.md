# Backend tổ chức theo module nhiều lớp, theo khuôn của repo tham chiếu

Backend chuyển sang khuôn của [TamokiLoi/ecommerce-franchise-training-nodejs](https://github.com/TamokiLoi/ecommerce-franchise-training-nodejs). Mỗi miền là một module trong `api/src/modules/<module>/` với đủ các lớp `module`, `route`, `controller`, `service`, `repository`, `mapper`, `dto`, `interface`. Lớp nền dùng chung nằm trong `api/src/core/`, và module mới được sinh bằng generator. Chủ dự án chọn hướng này ngày 2026-11-28, sau khi review repo tham chiếu, thay cho cách cũ: hàm nghiệp vụ nhận `tx` và router đặt trong `routes/`. Lý do chính là có một khuôn đồng nhất, để người mới biết file nào nằm ở đâu.

Khuôn được áp dụng nguyên dạng, trừ những chỗ repo tham chiếu có lỗi hoặc xung đột với ADR đã có:

- **Transaction và audit (ADR 0003):** service mở transaction; audit ghi trong cùng transaction, không ghi sau commit như `markPreparingOrder` của repo tham chiếu.
- **Repository bắt buộc nhận `db`:** mọi method của repository nhận `db: DbClient` làm tham số đầu, không phải tham số tùy chọn, để không thể vô tình chạy ngoài transaction. Bước chuyển trạng thái khóa dòng (`lockById`, `FOR UPDATE`), không kiểm trạng thái rồi mới ghi.
- **DTO lấy từ `@ecommerce/shared`:** file trong `dto/` export lại schema zod của shared, không viết DTO class-validator riêng, để web và API vẫn dùng chung một hợp đồng.
- **Quyền:** route nào cũng khai `requirePermission` hoặc kiểm quyền sở hữu (ADR 0002). Repo tham chiếu bỏ sót việc này ở module order.
- **Express 5:** controller không bọc `try/catch` rồi `next(err)`, vì Express 5 tự chuyển lỗi của hàm async sang error handler.
- **Hợp đồng HTTP giữ nguyên:** đường dẫn, mã trạng thái (không tìm thấy là 404) và body không đổi; không bọc response trong `{ data }`.

## Considered Options

- **Giữ cách cũ** (hàm nhận `tx`, route chuyển vào thư mục miền): ít code hơn và ít lớp chỉ chuyển tiếp lời gọi hơn, nhưng không có khuôn chung cho mọi miền. Không chọn.
- **Chỉ lấy khuôn thư mục và interface giữa các module, bỏ controller/repository:** được đề xuất trong buổi review 2026-11-28. Chủ dự án không chọn.

## Consequences

- Phải viết lại phần lớn khoảng 17.000 dòng của `api/src`. Làm dần từng module; trong lúc chuyển, code cũ và module mới chạy song song.
- Thêm các lớp chỉ chuyển tiếp lời gọi (controller, repository) ở những miền CRUD đơn giản. Đổi lại, mọi miền có cùng một dạng.
- Bộ test HTTP là lưới an toàn: không sửa test trong suốt quá trình chuyển.
- Thay thế spec `chuyen-route-vao-thu-muc-mien` (bỏ, chưa merge) và phần "Out of Scope" về repository/service class trong spec `quy-tac-trang-thai-don`.
