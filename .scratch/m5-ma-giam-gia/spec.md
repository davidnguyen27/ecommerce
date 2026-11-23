# Spec: M5 — Mã giảm giá

**Status:** resolved

Nguồn: `project-overview.md` (mục 4, 5.3, 6.2, 11), Out of Scope của spec M3 (`.scratch/m3-mua-hang/spec.md`) và M4 (`.scratch/m4-dat-truoc/spec.md`), và buổi làm rõ requirement ngày 2026-11-16 (28 câu, người dùng chấp nhận mọi đề xuất). Đây là mốc thứ năm trong lộ trình M0 → M8 của giai đoạn 1 (mở bán). Quyết định kiến trúc có liên quan: `docs/adr/0012-dat-truoc-nam-ngoai-gio-hang.md` (ưu đãi cho đơn đặt trước tính một lần trên đơn). Mốc này không có ADR mới.

## Problem Statement

Sau M4, khách mua được hàng sẵn và đặt trước, nhưng doanh nghiệp không có cách nào giảm giá cho một nhóm khách. Muốn chạy ưu đãi dịp lễ, tặng khách quen, hay xin lỗi khách vì giao trễ, nhân viên chỉ có thể sửa giá bán, mà sửa giá thì áp cho mọi người, mất dấu ai được giảm và không giới hạn được số lượt. Khách nhận mã qua mạng xã hội cũng không có chỗ nào để nhập.

## Solution

Nhân viên bán hàng tạo **mã giảm giá** (ví dụ `TET2027`): giảm một số tiền cố định hoặc một tỷ lệ có mức giảm tối đa, kèm thời hạn, đơn tối thiểu, phạm vi (toàn bộ, theo thương hiệu hoặc danh mục), hình thức bán (hàng sẵn, đặt trước hoặc cả hai), tổng số lượt và số lượt mỗi khách. Khách gõ mã ở trang đặt mua hoặc trang đặt trước, thấy ngay số tiền được giảm và tổng mới, hoặc lý do mã không dùng được. Lúc xác nhận, hệ thống kiểm lại mọi điều kiện. Mã vừa hết hiệu lực thì khách được báo và tự chọn đặt tiếp không mã hay thôi.

Phần giảm chỉ trừ vào tiền hàng, không trừ phí giao, và được chụp vào đơn. Với đơn đặt trước, tiền cọc tính trên tiền hàng sau giảm, nên phần giảm chia theo tỷ lệ giữa cọc và phần còn lại. Mỗi đơn chiếm một **lượt dùng** từ lúc tạo, và trả lại lượt nếu đơn bị hủy trước khi thanh toán.

Mốc này **chưa xử lý quyền lợi mã giảm giá khi hủy hay hoàn đơn đã thanh toán** (M6).

## User Stories

### Khách hàng

1. Là khách hàng, tôi muốn gõ mã giảm giá ở trang đặt mua, để được giảm cho đơn hàng sẵn.
2. Là khách hàng, tôi muốn gõ mã giảm giá ở trang đặt trước, để được giảm cho đơn đặt trước.
3. Là khách hàng, tôi muốn gõ mã không phân biệt chữ hoa chữ thường, để không bị từ chối vì gõ sai kiểu chữ.
4. Là khách hàng, sau khi áp mã tôi muốn thấy số tiền được giảm, phí giao (có thể đổi vì ngưỡng miễn phí giao tính trên tiền hàng sau giảm) và tổng mới, để biết mình trả bao nhiêu.
5. Là khách hàng, khi mã không dùng được, tôi muốn thấy đúng lý do (không tồn tại, chưa tới hạn, đã hết hạn, đã hết lượt, tôi đã dùng mã này, chưa đạt đơn tối thiểu, không áp cho sản phẩm hay hình thức bán này), để biết phải làm gì.
6. Là khách hàng, tôi muốn gỡ mã đã áp, để đặt mà không dùng mã.
7. Là khách hàng, khi mã vừa hết hiệu lực lúc tôi bấm xác nhận, tôi muốn được báo kèm tổng tiền khi không có mã, và tự chọn đặt tiếp hay thôi, để hệ thống không tự thu khác điều tôi đã thấy.
8. Là khách đặt trước, tôi muốn thấy tiền cọc và phần còn lại đã tính theo tiền hàng sau giảm, để biết phần giảm được chia thế nào.
9. Là khách hàng, tôi muốn thấy dòng mã giảm giá và số tiền giảm trong email xác nhận và trang đơn hàng.
10. Là khách đặt trước, tôi muốn phần giảm vẫn còn nguyên khi tôi trả phần còn lại, kể cả khi mã đã hết hạn từ lâu.
11. Là khách hàng, nếu tôi hủy đơn chưa thanh toán hoặc để đơn hết hạn, tôi muốn dùng lại được mã đó cho đơn sau.

### Nhân viên bán hàng

12. Là nhân viên bán hàng, tôi muốn tạo mã giảm số tiền cố định hoặc giảm theo tỷ lệ có mức tối đa, để chạy ưu đãi.
13. Là nhân viên bán hàng, tôi muốn đặt thời điểm bắt đầu và kết thúc cho mã, để ưu đãi tự bắt đầu và tự hết.
14. Là nhân viên bán hàng, tôi muốn đặt đơn tối thiểu, để chỉ đơn đủ lớn mới được giảm.
15. Là nhân viên bán hàng, tôi muốn giới hạn mã theo thương hiệu hoặc danh mục, để ưu đãi chỉ áp cho nhóm hàng tôi muốn đẩy.
16. Là nhân viên bán hàng, tôi muốn chọn mã áp cho hàng sẵn, đặt trước hay cả hai.
17. Là nhân viên bán hàng, tôi muốn đặt tổng số lượt và số lượt mỗi khách, để giới hạn chi phí ưu đãi; đặt tổng 1 lượt để làm mã xin lỗi cho một khách.
18. Là nhân viên bán hàng, tôi muốn hệ thống chặn mức giảm vượt 50%, để không vô tình vi phạm quy định khuyến mại.
19. Là nhân viên bán hàng, tôi muốn xem danh sách mã kèm số lượt đã dùng trên tổng lượt và trạng thái (sắp tới, đang chạy, hết hạn, đã tắt).
20. Là nhân viên bán hàng, tôi muốn xem chi tiết một mã kèm danh sách đơn đã dùng nó.
21. Là nhân viên bán hàng, tôi muốn tắt một mã ngay, để dừng ưu đãi bị lộ hay bị lạm dụng, mà không ảnh hưởng đơn đã đặt.
22. Là nhân viên bán hàng, tôi muốn kéo dài thời hạn hoặc tăng tổng lượt của mã đang chạy.
23. Là nhân viên bán hàng, tôi muốn các điều kiện chính bị khóa khi mã đã có lượt dùng, để khách đã dùng và khách sau được đối xử như nhau.

### Kế toán, chủ doanh nghiệp

24. Là nhân viên, tôi muốn lọc danh sách đơn theo mã giảm giá.
25. Là kế toán, tôi muốn chi tiết đơn hiện mã, tiền giảm và tiền hàng sau giảm, để xuất hóa đơn đúng.
26. Là kế toán, khi khôi phục một đơn từ danh sách cần đối soát, tôi muốn đơn giữ nguyên phần giảm khách đã được hưởng, kể cả khi mã đã hết lượt.
27. Là chủ doanh nghiệp, tôi muốn mọi thao tác tạo, sửa, tắt mã có trong audit log.
28. Là chủ doanh nghiệp, tôi muốn chỉ owner và nhân viên bán hàng tạo hay sửa được mã.

## Implementation Decisions

### Mã giảm giá

- Bảng mã giảm giá: mã (chữ và số, 4–20 ký tự, lưu chữ hoa, duy nhất toàn hệ thống kể cả mã đã tắt), mô tả nội bộ, loại (`fixed`, `percent`), giá trị (VND với `fixed`; số nguyên 1–50 với `percent`), mức giảm tối đa (VND, bắt buộc với `percent`, không có với `fixed`), đơn tối thiểu (VND, mặc định 0), thời điểm bắt đầu, thời điểm kết thúc (bắt buộc, sau bắt đầu), hình thức bán (`standard`, `preorder` hoặc cả hai), tổng lượt (để trống là không giới hạn), lượt mỗi khách (≥ 1, mặc định 1), thời điểm tắt (`disabled_at`, có thể trống), người tạo, thời điểm tạo.
- Phạm vi: hai bảng nối tùy chọn, danh sách thương hiệu và danh sách danh mục của mã. Cả hai trống là toàn bộ. Dòng đơn **thuộc phạm vi** khi thương hiệu của sản phẩm nằm trong danh sách thương hiệu (nếu có) **và** danh mục của sản phẩm là một danh mục trong danh sách hoặc con cháu của nó (nếu có).
- Mã **đang chạy** khi chưa tắt và hiện tại nằm trong [bắt đầu, kết thúc). Trạng thái hiển thị cho nhân viên: sắp tới, đang chạy, hết hạn, đã tắt. Mã không bị xóa, chỉ bị tắt. Đã tắt thì không bật lại; muốn chạy tiếp thì tạo mã khác.
- Sửa mã: khi chưa có lượt dùng nào thì sửa được mọi trường trừ chuỗi mã. Khi đã có ít nhất một lượt dùng thì chỉ sửa được mô tả, thời điểm kết thúc, tổng lượt (không thấp hơn số đã dùng, 409 nếu thấp hơn) và tắt. Các trường khác trả 409.
- **Số lượt đã dùng** của mã bằng số đơn chưa `cancelled` có mã đó. **Số lượt của một khách** bằng số đơn như vậy có email trùng (chữ thường) **hoặc** số điện thoại trùng. Cả hai tính khi cần, không lưu bộ đếm, giống cách tính suất của M4.

### Tính giảm

Cho một danh sách dòng đơn (hàng sẵn) hoặc một dòng (đặt trước), một hàm thuần tính:

1. **Tiền hàng thuộc phạm vi** = tổng (giá × số lượng) của các dòng thuộc phạm vi. Bằng 0 thì lý do `not_applicable`.
2. Tiền hàng thuộc phạm vi < đơn tối thiểu thì lý do `below_minimum` (kèm số còn thiếu).
3. Tiền giảm: `fixed` thì bằng giá trị; `percent` thì bằng tiền hàng thuộc phạm vi × tỷ lệ / 100, **làm tròn xuống tới 1.000 VND**, rồi lấy min với mức giảm tối đa.
4. Áp trần: tiền giảm ≤ **50%** tiền hàng thuộc phạm vi (làm tròn xuống tới 1.000 VND). Mức giảm `fixed` lớn hơn trần thì vẫn áp, nhưng chỉ được giảm tới trần.
5. Chia xuống từng dòng thuộc phạm vi theo tỷ lệ tiền hàng của dòng, làm tròn xuống tới đồng; phần lẻ dồn vào dòng có tiền hàng lớn nhất (bằng nhau thì dòng đầu).

Hàm này được test riêng như một module sâu: vào là các dòng, mã và phạm vi đã nạp; ra là tiền giảm, tiền giảm từng dòng, hoặc lý do.

### Mô hình đơn

- Đơn thêm: id mã giảm giá (có thể trống), chuỗi mã, loại, giá trị và mức tối đa của mã lúc đặt, và **tiền giảm** (`discount`, VND, mặc định 0). Check: `0 <= discount <= subtotal`, và `total = subtotal - discount + shipping_fee` (thay check cũ `total = subtotal + shipping_fee`). Migration đặt `discount = 0` cho đơn cũ.
- Dòng đơn thêm **tiền giảm của dòng** (`discount`, mặc định 0). Tổng tiền giảm các dòng phải bằng tiền giảm của đơn; check được ở tầng ứng dụng khi tạo đơn và trong test.
- Các giá trị trên chụp lúc tạo đơn và không đổi về sau, kể cả khi mã bị sửa hay tắt.
- **Phí giao:** ngưỡng miễn phí giao so với `subtotal - discount`.
- **Đơn đặt trước:** tiền cọc = làm tròn lên tới 1.000 VND của ((`subtotal - discount`) × tỷ lệ / 100). Check `0 < deposit_amount <= subtotal - discount`. Phần còn lại = `total - deposit_amount` như M4.

### Đặt mua và đặt trước

- `POST /api/checkout/quote` và `POST /api/preorders/quote` nhận thêm `voucherCode` (tùy chọn), và email, số điện thoại (tùy chọn, để kiểm lượt mỗi khách). Trả thêm `voucher`: hoặc `{ applied: true, code, discount, lines }` khi áp được, hoặc `{ applied: false, code, reason, shortfall? }` khi không (`shortfall` là tiền hàng còn thiếu khi chưa đạt đơn tối thiểu). Tiền giảm làm tròn ra 0 thì coi như mã không áp dụng (`not_applicable`), để đơn không chiếm lượt mà không được giảm. Báo giá luôn trả tổng **khi không có mã** lẫn tổng **khi có mã** (nếu áp được), để trang hiện được cả hai. Lượt mỗi khách chỉ kiểm khi có email hoặc số điện thoại. Không ghi gì.
- Lý do: `not_found`, `not_started`, `expired`, `disabled` (hiện cho khách như hết hạn), `exhausted`, `customer_limit`, `below_minimum`, `not_applicable`, `sale_type`; lúc đặt có thêm `changed` (tiền giảm khác số khách đã thấy). 409 khi đặt trước kèm thêm tiền cọc khi không dùng mã (`depositAmountWithoutVoucher`).
- `POST /api/checkout` và `POST /api/preorders` nhận thêm `voucherCode` và `discount` khách đã thấy. Trong transaction tạo đơn, **sau khi** khóa biến thể (và dòng đợt) như M3/M4:
  1. khóa dòng mã giảm giá `FOR UPDATE` (hai khách không cùng lấy được lượt cuối);
  2. kiểm toàn bộ điều kiện, tính lại tiền giảm;
  3. mã không còn dùng được, hoặc tiền giảm khác số khách đã thấy, thì 409 với `details` gồm lý do, tiền giảm mới (nếu có) và tổng khi không có mã; không ghi gì;
  4. tạo đơn với phần giảm đã chụp; số tiền của link thanh toán là `total` (hàng sẵn) hoặc tiền cọc (đặt trước) đã tính sau giảm.
- Đổi giá trong lúc khách đặt (409 của M3/M4) vẫn như cũ; trang báo giá lại sẽ tính lại tiền giảm.
- Giới hạn tần suất: báo giá có `voucherCode` dùng thêm một bucket theo IP, 10 lần mỗi phút (`http/rate-limit.ts`); vượt thì 429. Kiểm mã chỉ đi qua hai endpoint báo giá, không có endpoint riêng.

### Hủy, hết hạn, đối soát

- Hủy hoặc hết hạn đơn chưa thanh toán (M3/M4): không làm gì thêm. Lượt tự trống vì đơn đã `cancelled`.
- Khôi phục đơn từ danh sách cần đối soát (`restoreOrder`): đơn giữ nguyên phần giảm đã chụp, **không kiểm lại mã** (hạn, tắt, tổng lượt, lượt mỗi khách). Nếu việc khôi phục làm số lượt vượt tổng lượt, sự kiện đơn và audit log ghi rõ `voucher_over_limit`.
- So khớp số tiền của IPN dùng `total` hoặc tiền cọc, phần còn lại đã tính sau giảm; không có nhánh mới.

### Quyền

- Quyền mới `voucher.manage` (owner, sales): tạo, sửa, tắt mã.
- Xem danh sách và chi tiết mã: `voucher.manage` hoặc `order.view` (để kế toán xem được).
- Mọi thao tác ghi đi qua `audited()`: `voucher.create`, `voucher.update` (trước và sau), `voucher.disable`.

### API quản trị

- Mã: danh sách (lọc theo trạng thái, tìm theo mã, phân trang `PageQuery`, kèm số lượt đã dùng), chi tiết (kèm phạm vi và danh sách đơn đã dùng, phân trang), tạo, sửa, tắt.
- Danh sách đơn thêm bộ lọc theo mã giảm giá.
- Chi tiết đơn trả thêm mã, tiền giảm, tiền hàng sau giảm và tiền giảm từng dòng.

### Email

Các email đã có (đã nhận thanh toán, đã nhận cọc, hàng đã về, nhắc trả phần còn lại) hiện thêm dòng mã giảm giá và tiền giảm khi đơn có mã. Không có email mới.

### Web

- Khách: trang đặt mua và trang đặt trước có ô "Mã giảm giá" với nút Áp dụng và Gỡ; hiện lý do khi mã không dùng được; bảng tiền thêm dòng "Mã giảm giá `XXX` −số tiền", phí giao và tổng cập nhật theo; khi xác nhận nhận 409 về mã thì hộp thoại hiện lý do, tổng khi không có mã, và hai nút "Đặt không dùng mã" và "Quay lại". Trang đơn hàng (token và tài khoản) hiện dòng mã giảm giá. Giỏ hàng không có ô nhập mã. Không có trang liệt kê mã.
- Admin: mục Mã giảm giá (danh sách, form tạo/sửa với phần trường bị khóa khi đã có lượt dùng, chi tiết kèm đơn đã dùng, nút tắt). Form chọn thương hiệu và danh mục dùng lại các bộ chọn sẵn có. Chi tiết đơn hiện mã và tiền giảm. Danh sách đơn có bộ lọc theo mã. Menu khai quyền qua `ADMIN_MENU_ITEMS`. Phiếu soạn hàng không đổi.
- `scripts/demo-seed.ts`: khi chạy local thì tạo thêm một mã mẫu đang chạy (ví dụ `DEMO10`: giảm 10%, tối đa 500.000, cả hai hình thức bán). Không tạo mã khi seed vào bản deploy.

## Testing Decisions

- Test kiểm hành vi bên ngoài qua HTTP như M3/M4, trên Postgres thật, cổng thanh toán giả trong bộ nhớ, và job gọi thẳng với `now` ở tương lai. Riêng hàm tính giảm có unit test riêng vì là logic thuần nhiều nhánh. Prior art: `checkout.test.ts`, `preorders.test.ts`, `preorder-deposit.test.ts`, `reconciliation.test.ts`, `shipping-fee.test.ts`, `rate-limit.test.ts`.
- E2E: nhân viên tạo mã → khách áp mã ở trang đặt mua, thấy tổng mới → giả lập thanh toán → trang đơn hiện tiền giảm. Thêm một luồng đặt trước có mã, kiểm tiền cọc và phần còn lại.
- Các hành vi bắt buộc có test:
  - **Tính giảm:** `fixed` và `percent`; làm tròn xuống 1.000; mức tối đa; trần 50% với cả `fixed` lớn; đơn tối thiểu tính trên tiền hàng thuộc phạm vi; phạm vi theo thương hiệu, theo danh mục gồm con cháu, và cả hai; không dòng nào thuộc phạm vi; chia xuống dòng có tổng đúng bằng tiền giảm, phần lẻ vào dòng lớn nhất.
  - **Quản trị mã:** tạo, sửa, tắt; mã trùng (khác hoa thường) thì 409; tỷ lệ > 50 hoặc thiếu mức tối đa thì 400; sửa trường bị khóa khi đã có lượt thì 409; giảm tổng lượt dưới số đã dùng thì 409; thiếu `voucher.manage` thì 403; `order.view` xem được nhưng không sửa được; audit log có trước và sau.
  - **Báo giá:** mỗi lý do trả đúng; lượt mỗi khách chỉ kiểm khi có email hoặc số điện thoại; phí giao đổi khi tiền hàng sau giảm xuống dưới ngưỡng miễn phí; vượt 10 lần mỗi phút thì 429.
  - **Tạo đơn:** đơn và dòng đơn chụp đúng phần giảm; `total` và số tiền link đúng; mã hết hạn, đã tắt, hết lượt, khách đã dùng, tiền giảm khác số khách thấy đều 409 kèm `details` và không ghi gì; nhiều khách tranh lượt cuối song song thì đúng một đơn có mã; lượt mỗi khách nhận diện qua email khác hoa thường và qua số điện thoại.
  - **Đặt trước:** tiền cọc tính trên tiền hàng sau giảm, làm tròn lên 1.000; phần còn lại đúng; mã chỉ áp `standard` thì `sale_type`; trả phần còn lại sau khi mã hết hạn vẫn giữ phần giảm.
  - **Lượt:** hủy và hết hạn đơn chưa trả thì lượt trống lại; IPN lặp không làm đổi lượt hay tiền giảm.
  - **Đối soát:** khôi phục đơn khi mã đã hết lượt thì thành công, giữ phần giảm, có `voucher_over_limit` trong audit.
  - **Migration:** đơn cũ có `discount = 0` và vẫn thỏa check mới.

## Out of Scope

- Quyền lợi mã giảm giá khi hủy hoặc hoàn đơn đã thanh toán, gồm việc trả lại lượt và số tiền hoàn (M6).
- Chương trình khuyến mại tự áp không cần gõ mã; giảm giá theo sản phẩm hiển thị trên trang sản phẩm.
- Mã miễn phí giao, hoặc giảm vào phí giao.
- Nhiều mã trên một đơn, cộng dồn mã.
- Mã riêng sinh hàng loạt cho từng khách; gửi mã qua email.
- Phạm vi theo từng sản phẩm hay biến thể, và danh sách loại trừ.
- Mã chỉ cho khách có tài khoản, cho khách mới, hay theo hạng khách.
- Trang liệt kê mã cho khách; nhập mã ở giỏ hàng.
- Bật lại mã đã tắt; xóa mã.
- Kết hợp điểm thưởng (giai đoạn 2). Báo cáo hiệu quả mã (M7).

## Further Notes

- GLOSSARY có mục mới **Mã giảm giá** và **Lượt dùng**; định nghĩa **Đơn hàng** thêm mã giảm giá đã dùng; **Tiền cọc** tính trên tiền hàng sau giảm.
- Buổi làm rõ 2026-11-16 chốt: chỉ mã khách gõ, gọi là mã giảm giá; giảm số tiền cố định hoặc tỷ lệ có mức tối đa; chỉ giảm vào tiền hàng; một mã mỗi đơn; mã dùng chung có tổng lượt và lượt mỗi khách; áp cho cả hàng sẵn và đặt trước theo cấu hình; trần 50%; quyền `voucher.manage` cho owner và sales; phạm vi theo thương hiệu, danh mục; ngưỡng miễn phí giao tính sau giảm; phần giảm của đơn đặt trước chia theo tỷ lệ giữa cọc và phần còn lại; lượt chiếm khi tạo đơn, trả khi hủy trước thanh toán; khách nhận diện theo email hoặc số điện thoại; chụp vào đơn và khóa điều kiện khi đã có lượt; 409 khi mã hết hiệu lực lúc xác nhận; mã 4–20 ký tự không phân biệt hoa thường, không có trang liệt kê; giới hạn 10 lần kiểm mỗi phút theo IP; khôi phục đơn giữ phần giảm dù vượt lượt; không cần ADR mới.
- **Đã chốt (2026-11-23, người dùng thay chủ doanh nghiệp): giữ nguyên các số và nội dung dưới đây.**
  1. Trần giảm 50% theo Nghị định 81/2018, và việc chương trình mã giảm giá có phải thông báo với Sở Công Thương hay không.
  2. Ngưỡng miễn phí giao tính trên tiền hàng sau giảm.
  3. Cách chia phần giảm giữa tiền cọc và phần còn lại của đơn đặt trước; nội dung này cần ghi vào trang chính sách đặt trước.
- Các con số tạm: mã 4–20 ký tự, 10 lần kiểm mỗi phút theo IP, mặc định 1 lượt mỗi khách.
