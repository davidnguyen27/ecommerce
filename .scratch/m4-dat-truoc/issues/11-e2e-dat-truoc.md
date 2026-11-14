# 11: E2E Playwright luồng đặt trước

**What to build:**
- Một kịch bản Playwright chạy trên stack của `pnpm smoke --keep` với cổng giả lập, đi trọn vòng đời của một đơn đặt trước qua giao diện thật.

**Blocked by:** 10

**Status:** ready-for-agent

- [ ] Kịch bản: nhân viên mở đợt cho biến thể hết hàng → khách thấy "Đặt trước", đặt 2 cái, giả lập trả cọc → kho ghi phiếu nhập 1 cái (xem trước báo giữ 1), rồi thêm 2 cái (giữ 1, dư 1 thành hàng sẵn) → khách trả phần còn lại → kho soạn, bàn giao, đã giao
- [ ] Ở từng bước kiểm tra: tồn, đang giữ, sổ xuất nhập, ba trạng thái của đơn, và tình trạng biến thể khách thấy
- [ ] Chạy được trong CI cùng E2E của M3

Spec: mục "Testing Decisions".
