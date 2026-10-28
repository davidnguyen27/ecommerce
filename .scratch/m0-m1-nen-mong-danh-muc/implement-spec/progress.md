# Tiến độ /implement-spec: cập nhật 2026-10-24 (phiên 2)

Nhánh tích hợp: `spec/m0-m1-nen-mong-danh-muc` (tip `fd0ffbc` trước commit ghi chú này), tách từ `main` (`e3aa9f9`).
Ghi chú cho subagent: `implement-spec-notes.md`. Danh sách sửa sau code review: `review-fixes.md` (cùng thư mục này).

## Đã xong
- Đã merge, resolved: 04 (chỉ đổi trạng thái), 17, 08, 05, 06, 09, 10, 13, 11, 12, 14. Sau merge 14: typecheck, lint, 238/238 test, smoke đều qua.
- 15, 16: `ready-for-human`, ngoài phạm vi lượt này.
- Code review toàn nhánh (Standards + Spec) đã chạy; kết quả gom trong `review-fixes.md`.

## Đã xong ở phiên 2
- Bước 7: đủ 11 mục của `review-fixes.md` trên `fix/review`, đã merge (`fd0ffbc`). Sau merge: typecheck, lint, 244/244 test, smoke đều qua.
- Lỗi 500 ngẫu nhiên trong test (mục 5): Postgres test khựng I/O, transaction Prisma quá 5s thì hết hạn. Đã tắt fsync cho Postgres test và đặt pool nhỏ; trước đó cứ khoảng 3 lượt chạy toàn bộ test thì 1 lượt lỗi, giờ khoảng 1/14 lượt còn một test lỗi (timeout khi lấy kết nối, hoặc 500 không rõ nguyên nhân). Còn mở, chưa xử lý tiếp.
- Bước 3: đã xóa mọi worktree agent và các nhánh ticket/*, fix/review đã merge.

## Còn lại
1. Giao diện Tailwind: đã chuyển thẳng trên nhánh tích hợp (`b3dbbda`, 2026-10-28), không merge `ui/tailwind`. Website dùng Tailwind/Shadcn, admin giữ `admin.css` (selector chung đã gắn phạm vi `.admin-shell`). Typecheck, lint, smoke qua; đã xem bằng mắt các trang khách và /admin/login (sửa /admin/login bỏ layout website, `b32274a`). Còn: xem các trang admin sau đăng nhập, quyết định xóa nhánh `ui/tailwind`.
2. Báo cáo nhánh tích hợp và danh sách cần chủ doanh nghiệp xác nhận (dưới đây).

## Cần chủ doanh nghiệp xác nhận
- 07: ẩn danh mục thì ẩn cả nhánh con trên website.
- 08: giá trị seed của schema thuộc tính; size/màu nhập tự do.
- 05: Resend làm nhà cung cấp email; chặn đăng ký (503) khi chưa xuất bản chính sách bảo mật.
- 06: ngưỡng giới hạn tần suất (đăng nhập 10/15 phút theo email, 50 theo IP; quên mật khẩu 3/giờ theo email, 20 theo IP); link đặt lại hết hạn sau 1 giờ.
- 12: ngưỡng gõ sai 0,6; khớp tiền tố SKU từ 3 ký tự; chưa chọn nhóm hàng thì chỉ lọc được giới tính, giá, nhóm hàng; chỉ mục tìm kiếm cập nhật khi xuất bản.
- Đã quyết khi review (đã làm): đổi giá của sản phẩm đã xuất bản lên website ngay, không cần xuất bản lại; cam kết có bằng chứng đi theo bản xuất bản.

## Chẩn đoán test chập chờn (/diagnosing-bugs), 2026-10-28
- Triệu chứng: `Connection terminated due to connection timeout` (pg-pool). Tái hiện: 3 bộ test đầy đủ song song thì 5/6 lượt đỏ.
- Nguyên nhân (đã đo): có những khoảng 10–40 giây mà kết nối mới từ Windows vào container Postgres test không tới được Postgres. Trong lúc đó Postgres vẫn khỏe (`pg_isready` bên trong container chạy đều, log không có `connection received` của test), worker Node vẫn khỏe (độ trễ event loop khoảng 50 ms), TCP tới proxy cục bộ của Docker vẫn xong ngay (`SYN_SENT`=0). Đợt treo xảy ra riêng theo từng container. Tức là lớp chuyển cổng của Docker Desktop trên Windows bị đứng.
- Đã loại: Postgres thiếu CPU; event loop nghẽn; cạn cổng tạm (khoảng 1.600 TIME_WAIT/15.700); riêng đường IPv6 (127.0.0.1 vẫn đỏ); mở kết nối quá dày (bỏ pg-boss khỏi test không gửi mail, giảm khoảng 75% kết nối, vẫn treo và còn tệ hơn vì truy vấn đầu tiên của pg-boss chờ 10s rồi nuốt lỗi, vô tình che đợt treo cho Prisma). Đã khôi phục.
- Chưa sửa. Code app không có lỗi; cần chọn cách xử lý môi trường (chạy test API trong container Linux, dựa vào CI Linux, hoặc nới timeout kết nối trong test).
