# Tiến độ /implement-spec: tạm dừng 2026-10-24

Nhánh tích hợp: `spec/m0-m1-nen-mong-danh-muc` (tip `ab54b11`), tách từ `main` (`e3aa9f9`).
Ghi chú cho subagent: `implement-spec-notes.md`. Danh sách sửa sau code review: `review-fixes.md` (cùng thư mục này).

## Đã xong
- Đã merge, resolved: 04 (chỉ đổi trạng thái), 17, 08, 05, 06, 09, 10, 13, 11, 12, 14. Sau merge 14: typecheck, lint, 238/238 test, smoke đều qua.
- 15, 16: `ready-for-human`, ngoài phạm vi lượt này.
- Code review toàn nhánh (Standards + Spec) đã chạy; kết quả gom trong `review-fixes.md`.

## Đang dở: bước 7, sửa theo code review
- Worktree `.claude/worktrees/agent-a27ef730a741192f0`, nhánh `fix/review` (chưa có commit, đứng ở `ab54b11`).
- Có **thay đổi chưa commit** (đang làm mục 1–4 của `review-fixes.md`): `api/src/catalog/commitments.ts`, `catalog/publication.ts`, `media/images.ts`, `routes/admin-products.ts`, `routes/public-products.ts` và 4 file test. Chưa chạy test. Đọc `git diff` trong worktree đó trước khi làm tiếp; đừng xóa.

## Còn lại
1. Làm nốt `review-fixes.md` trên `fix/review` (TDD, chạy full test 3 lần), rồi merge vào nhánh tích hợp (merger: typecheck, lint, test, smoke).
2. Merge `ui/tailwind` (`0e1e0fc`, bản làm lại giao diện bằng Tailwind/reka-ui, đang làm dở) vào nhánh tích hợp sau cùng; chuyển các trang mới của ticket 11/12/14 sang giao diện mới. Hỏi chủ dự án trước nếu bản UI chưa xong.
3. Dọn worktree của các agent (`git worktree list`; nhánh `ticket/*` đã merge thì xóa được).
4. Báo cáo nhánh tích hợp và danh sách cần chủ doanh nghiệp xác nhận (dưới đây).

## Cần chủ doanh nghiệp xác nhận
- 07: ẩn danh mục thì ẩn cả nhánh con trên website.
- 08: giá trị seed của schema thuộc tính; size/màu nhập tự do.
- 05: Resend làm nhà cung cấp email; chặn đăng ký (503) khi chưa xuất bản chính sách bảo mật.
- 06: ngưỡng giới hạn tần suất (đăng nhập 10/15 phút theo email, 50 theo IP; quên mật khẩu 3/giờ theo email, 20 theo IP); link đặt lại hết hạn sau 1 giờ.
- 12: ngưỡng gõ sai 0,6; khớp tiền tố SKU từ 3 ký tự; chưa chọn nhóm hàng thì chỉ lọc được giới tính, giá, nhóm hàng; chỉ mục tìm kiếm cập nhật khi xuất bản.
- Đã quyết khi review (đang sửa): đổi giá của sản phẩm đã xuất bản lên website ngay, không cần xuất bản lại; cam kết có bằng chứng đi theo bản xuất bản.
