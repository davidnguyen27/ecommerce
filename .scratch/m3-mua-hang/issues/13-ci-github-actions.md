# 13: CI trên GitHub Actions

**What to build:**
- Mỗi lần push và mỗi PR lên GitHub tự chạy lint, typecheck, test API và smoke trên runner Linux.
- Phần CI được tách khỏi ticket 15 của M0–M1. Phần build image, deploy và VPS vẫn ở ticket đó, chờ khi có domain và VPS.

**Blocked by:** —

**Status:** ready-for-agent

- [ ] `.github/workflows/ci.yml` chạy khi push và pull_request; dùng pnpm có cache, Node theo phiên bản repo đã khai (`engines` hoặc `.nvmrc`)
- [ ] Các job: lint, typecheck, test API, `pnpm smoke`. Testcontainers chạy được trên runner ubuntu vì runner đã có sẵn Docker
- [ ] Không bật retry để che lỗi. Theo ghi chú ở ticket 15 của M0–M1, CI Linux là chuẩn để đánh giá test chập chờn trên Docker Desktop
- [ ] Không cần secret: workflow dùng giá trị test, cổng thanh toán là cổng giả lập
- [ ] Ghi vào ticket 15 của M0–M1 rằng phần CI đã chuyển sang ticket này
- [ ] Kiểm tra workflow hợp lệ (bằng `actionlint` nếu chạy được). Muốn chạy thật trên GitHub thì phải push nhánh: báo người dùng để họ push và xem kết quả

**Ghi chú:** `knip` (ghi ở retro) để sau, không thuộc ticket này.
