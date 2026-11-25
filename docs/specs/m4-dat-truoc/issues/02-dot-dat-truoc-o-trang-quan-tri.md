# 02: Đợt đặt trước ở trang quản trị

**What to build:**
- Nhân viên bán hàng tạo, sửa, đóng đợt đặt trước cho một sản phẩm, gồm: biến thể và số suất từng biến thể, tỷ lệ cọc, thời gian giao dự kiến, hạn đóng nhận đặt, số ngày được trả phần còn lại, trạng thái nhập hàng kèm ghi chú nội bộ.

**Blocked by:** —

**Status:** resolved

- [x] Bảng đợt và bảng biến thể của đợt như spec. Ràng buộc: tỷ lệ cọc 10–100, suất ≥ 1, số ngày ≥ 1 (mặc định 7), ngày giao "từ" ≤ "đến", mỗi biến thể một lần trong một đợt, biến thể phải thuộc sản phẩm của đợt
- [x] Đợt đang mở khi `closed_at` trống và chưa tới hạn đóng. Mỗi sản phẩm tối đa một đợt đang mở: khóa sản phẩm `FOR UPDATE` khi tạo, trùng thì 409. Không tạo được đợt cho sản phẩm chưa xuất bản hoặc đã lưu trữ
- [x] Sửa: thời gian giao dự kiến, hạn đóng, suất, thêm biến thể, trạng thái nhập hàng (`not_ordered`, `ordered`, `in_transit`, `issue`) và ghi chú. Đóng tay ghi `closed_at`, không mở lại được
- [x] Viết sẵn hàm "số đã dùng" (tổng số lượng của đơn đặt trước chưa hủy của đợt theo biến thể) và áp các quy tắc khóa: giảm suất dưới số đã dùng thì 409; đợt đã có đơn thì không sửa tỷ lệ cọc, số ngày, không bỏ biến thể đã có đơn (409). Trước ticket 04 chưa có đơn nào, nên test dựng đơn bằng `prisma`
- [x] Quyền mới `preorder.manage` (owner, sales) cho thao tác ghi; `order.view` để xem. Mọi thao tác ghi đi qua `audited()`
- [x] API: danh sách (lọc đang mở/đã đóng, theo sản phẩm, `PageQuery`), chi tiết (từng biến thể: suất, số đã dùng), tạo, sửa, đóng. Schema trong `@ecommerce/shared`
- [x] Web admin: mục "Đặt trước" trong `ADMIN_MENU_ITEMS` (danh sách đợt, form tạo/sửa, nút đóng)
- [x] Test qua HTTP: tạo/sửa/đóng; đợt thứ hai đang mở cho cùng sản phẩm 409; hết hạn đóng thì được mở đợt mới; các quy tắc khóa ở trên; 403 khi thiếu quyền; audit ghi đủ

Spec: mục "Đợt đặt trước", "Quyền".

**Quyết định khi triển khai (2026-11-15):**
- Migration `20261114000200_preorder_campaigns`:
  - enum `preorder_supply_status`;
  - bảng `preorder_campaign` với check: cọc 10–100, `delivery_from <= delivery_to`, `remainder_days >= 1`;
  - bảng `preorder_campaign_variant` (khóa chính `(campaign_id, variant_id)`, check `allocation >= 1`);
  - `order.preorder_campaign_id` (nullable, FK, index). Cột này thêm ở ticket 02 thay vì 04, vì hàm "số đã dùng" cần biết đơn thuộc đợt nào. Ticket 04 vẫn thêm loại đơn và các trường cọc.
  Đã đối chiếu migration với schema bằng `prisma migrate diff` trên một Postgres tạm: không có khác biệt nào liên quan tới M4.
- "Biến thể thuộc sản phẩm của đợt" và "mỗi sản phẩm tối đa một đợt đang mở" không viết thành constraint: điều thứ hai phụ thuộc thời điểm hiện tại. API kiểm cả hai; tạo đợt khóa dòng sản phẩm `FOR UPDATE`. Test ba request song song: đúng một 201.
- `api/src/preorders/campaigns.ts`:
  - `isCampaignOpen`, `openCampaignWhere`;
  - `usedAllocations(db, campaignIds)`: một câu SQL cộng `order_line.quantity` của đơn có `preorder_campaign_id` và `status <> 'cancelled'`, nhóm theo đợt và biến thể;
  - `loadCampaign`, cùng các hàm chuyển sang response.
  Ticket 03 và 04 dùng lại các hàm này.
- Route `/api/admin/preorder-campaigns` (`admin-preorder-campaigns.ts`). Router cần `order.view` **hoặc** `preorder.manage`; thao tác ghi cần `preorder.manage`:
  - `GET /` (`state=open|closed|all`, `productId`, `PageQuery`, mới tạo trước; kèm `variantCount`, `totalAllocation`, `totalUsed`);
  - `GET /:id`;
  - `POST /` (201);
  - `PATCH /:id`;
  - `POST /:id/close`.
  Không có endpoint xóa.
- Mã lỗi:
  - sản phẩm chưa xuất bản hoặc đã lưu trữ, hay đã có đợt đang mở → 409;
  - biến thể lạ, của sản phẩm khác, hay ngừng bán (chỉ kiểm biến thể **mới** thêm vào đợt) → 400 theo `variants.<i>.variantId`;
  - hạn đóng ở quá khứ → 400 `closesAt`;
  - suất < số đã dùng → 409 theo `variants.<i>.allocation`;
  - bỏ biến thể đã có đơn → 409 `variants`, thông báo nêu SKU;
  - đổi mức cọc hay số ngày khi đợt đã có đơn chưa hủy → 409.
- `PATCH` nhận các trường tùy chọn. `variants` là **toàn bộ** danh sách sau khi lưu: thêm, sửa suất, bỏ biến thể chưa có đơn. Đổi hạn đóng của đợt đã đóng (tay hay tới hạn) → 409, vì như thế là mở lại đợt. Đợt đã đóng vẫn sửa được tiến độ nhập, ngày giao và suất. Khóa đợt rồi các dòng suất `FOR UPDATE` theo thứ tự biến thể; ticket 04 cần khóa dòng suất khi kiểm còn suất.
- Không đổi gì (gửi lại đúng giá trị hiện tại) → 200, không audit. Đóng đợt đã đóng → 200, không audit.
- Audit:
  - `preorder.campaign.create`: `after` là input;
  - `preorder.campaign.update`: `before`/`after` chỉ chứa các trường đổi, `variants` là danh sách đã sắp xếp;
  - `preorder.campaign.close`: `after { closedAt }`.
  `entityType` `preorder_campaign`.
- Quyền `preorder.manage` cấp cho sales (owner có mọi quyền). Sales đã có `order.view`. Kho và kế toán chỉ xem được.
- Web:
  - `/admin/preorders` (danh sách, lọc Tất cả/Đang mở/Đã đóng);
  - `/admin/preorders/new` (chọn sản phẩm đã xuất bản qua `/api/admin/products`, nên cần quyền xem sản phẩm; owner và sales đều có);
  - `/admin/preorders/[id]` (chi tiết, "Sửa đợt", "Đóng đợt" kèm hỏi xác nhận).
  Form dùng chung `AdminPreorderCampaignForm`. Form khóa mức cọc và số ngày khi đợt có đơn, khóa hạn đóng khi đợt đã đóng, và không cho bỏ chọn biến thể đã có đơn. Ô hạn đóng là `datetime-local`, chỉ chính xác tới phút, nên form chỉ gửi `closesAt` khi người dùng đổi nó. Trang chi tiết chỉ tải sản phẩm (để thêm biến thể) khi người dùng có quyền của trang Sản phẩm, lấy từ `ADMIN_MENU_ITEMS`.
- Menu: "Đặt trước" trong nhóm Bán hàng, quyền `order.view` hoặc `preorder.manage`. Nhãn tiến độ nhập nằm ở `utils/preorderLabels.ts`.
- **Chưa xem bằng trình duyệt.** Typecheck của Nuxt qua; E2E ở ticket 11.
- Test: `api/test/preorder-campaigns.test.ts` (13 test). Toàn bộ bộ test API (42 file, 468 test) qua trên máy.
