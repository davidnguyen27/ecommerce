# 03: Áp mã cho đơn hàng sẵn

**What to build:**
- Khách gõ mã ở trang đặt mua, thấy tiền giảm, phí giao và tổng mới, hoặc lý do mã không dùng được; xác nhận thì đơn được tạo với phần giảm đã chụp và link thanh toán đúng số tiền sau giảm. Mã vừa hết hiệu lực lúc xác nhận thì khách được báo và tự chọn đặt tiếp không mã hay thôi.

**Blocked by:** 01, 02

**Status:** resolved

- [x] Migration: `order` thêm chuỗi mã, loại, giá trị, mức tối đa lúc đặt và `discount` (mặc định 0); `order_line` thêm `discount` (mặc định 0). Đổi check thành `total = subtotal - discount + shipping_fee` và thêm `0 <= discount <= subtotal`. Đơn cũ thỏa check mới
- [x] Một hàm kiểm mã dùng chung cho báo giá và tạo đơn: nạp mã theo chuỗi (không phân biệt hoa thường), kiểm `not_found`, `disabled`, `not_started`, `expired`, `sale_type`, `exhausted`, `customer_limit` (chỉ khi có email hoặc số điện thoại), rồi gọi hàm tính giảm của ticket 01
- [x] Phí giao: ngưỡng miễn phí giao so với `subtotal - discount`
- [x] `POST /api/checkout/quote` nhận `voucherCode`, email, số điện thoại (tùy chọn); trả `voucher` (áp được: mã, tiền giảm, từng dòng; không áp được: mã, lý do, `details`) cùng tổng khi không có mã và tổng khi có mã. Không ghi gì
- [x] Báo giá có `voucherCode` dùng thêm bucket giới hạn tần suất theo IP, 10 lần mỗi phút (`http/rate-limit.ts`); vượt thì 429
- [x] `POST /api/checkout` nhận `voucherCode` và `discount` khách đã thấy. Trong transaction, sau khi khóa biến thể như M3: khóa dòng mã `FOR UPDATE`, kiểm lại toàn bộ, tính lại. Mã không còn dùng được, hoặc tiền giảm khác số khách thấy, thì 409 với `details` gồm lý do, tiền giảm mới (nếu có) và tổng khi không có mã; không ghi gì. Đủ điều kiện thì chụp phần giảm vào đơn và dòng đơn; link thanh toán bằng `total` sau giảm
- [x] Email đã nhận thanh toán và trang đơn hàng (token và tài khoản) hiện dòng "Mã giảm giá `XXX` −số tiền" khi đơn có mã
- [x] Web khách: trang đặt mua có ô "Mã giảm giá" với nút Áp dụng và Gỡ, hiện lý do bằng tiếng Việt cho từng mã lỗi, bảng tiền thêm dòng giảm và cập nhật phí giao, tổng. Nhận 409 về mã thì hộp thoại hiện lý do, tổng khi không có mã, hai nút "Đặt không dùng mã" và "Quay lại". Giỏ hàng không có ô nhập mã
- [x] Test qua HTTP: mỗi lý do trả đúng ở báo giá; lượt mỗi khách chỉ kiểm khi có email hoặc số điện thoại; phí giao đổi khi tiền hàng sau giảm xuống dưới ngưỡng; 429 khi vượt tần suất; đơn và dòng đơn chụp đúng phần giảm; `total` và số tiền link đúng; mã hết hạn, đã tắt, hết lượt, khách đã dùng, tiền giảm lệch đều 409 và không ghi gì; nhiều khách tranh lượt cuối song song thì đúng một đơn có mã; lượt mỗi khách nhận diện qua email khác hoa thường và qua số điện thoại; hủy và hết hạn đơn chưa trả thì lượt trống lại; IPN lặp không đổi lượt hay tiền giảm

Spec: mục "Mô hình đơn", "Đặt mua và đặt trước", "Hủy, hết hạn, đối soát", "Email", "Web".

**Quyết định khi triển khai (2026-11-16):**
- Migration `20261117000200_order_discount`:
  - `order`: `voucher_code`, `voucher_kind`, `voucher_amount`, `voucher_percent`, `voucher_max_discount`, `discount` (mặc định 0);
  - `order_line.discount` (mặc định 0, check `0 <= discount <= price * quantity`);
  - thay `order_money_check` bằng `total = subtotal - discount + shipping_fee` và `0 <= discount <= subtotal`;
  - `order_voucher_check`: không có mã thì không có trường chụp nào và `discount = 0`; có mã thì có đủ trường chụp theo đúng loại.
- `api/src/vouchers/apply.ts`: `checkVoucher(db, code, { saleType, lines, customer, lock })` dùng chung cho báo giá và tạo đơn. Thứ tự kiểm: `not_found`, `disabled`, `not_started`, `expired`, `sale_type`, `exhausted`, `customer_limit` (chỉ khi có email hoặc số điện thoại), rồi hàm tính giảm (`below_minimum` kèm `shortfall`, `not_applicable`). Danh mục tổ tiên đọc cả bảng `category` một lần. `lock` khóa dòng mã `FOR UPDATE` sau khi đã khóa biến thể. `voucherSnapshot` trả các cột chụp vào đơn. Thương hiệu và danh mục lấy từ snapshot đang xuất bản.
- Schema shared:
  - `VoucherReason` thêm `changed` cho trường hợp tiền giảm khác số khách đã thấy;
  - `VoucherCodeInput` nhận chuỗi bất kỳ 1–40 ký tự: mã sai định dạng trả `not_found`, không trả lỗi form;
  - `VoucherQuote` phân theo `applied`; `VoucherConflict`;
  - `CheckoutQuoteRequest` thêm `voucherCode`, `email`, `phone`. Email và số điện thoại sai định dạng thì `.catch(undefined)`, tức coi như chưa nhập;
  - `CheckoutQuote` thêm `voucher`, `discount`, `shippingFeeWithoutVoucher`, `totalWithoutVoucher`;
  - `CheckoutRequest` thêm `voucherCode`, `discount` (mặc định 0);
  - `CheckoutConflictDetails` thêm `voucher` (tùy chọn);
  - `PublicOrder` thêm `voucherCode`, `discount`.
- Đặt mua: mã chỉ được kiểm khi mọi dòng đã đúng. Dòng sai thì 409 theo dòng như M3, không có `voucher`. Khi mã có vấn đề, 409 trả `lines: []` và `voucher: { code, reason, discount, shortfall?, totalWithoutVoucher }`. Sự kiện đơn `created` ghi thêm `voucherCode` và `discount`.
- Giới hạn tần suất `voucher-check:ip`: 10 lần mỗi phút, chỉ tính báo giá có `voucherCode`. Đặt mua vẫn dùng giới hạn `checkout:ip` của M3, nên test phải chia nhỏ để không vượt 5 lần đặt mỗi giờ.
- Email "đã nhận thanh toán" có dòng `Mã giảm giá CODE: -x ₫` qua `voucherLines(order)`. Ticket 04 dùng lại hàm này cho các email đặt trước.
- Web:
  - component `VoucherField` (ô mã, nút Áp dụng / Gỡ mã, lý do). Không dùng `<form>` vì ô nằm trong form đặt mua; Enter áp mã;
  - `utils/voucherReasons.ts` chứa câu báo lỗi cho khách;
  - `dat-mua.vue` giữ `voucherCode` và gửi kèm mọi lần báo giá, cùng email và số điện thoại đang nhập. Bảng tiền có dòng giảm. Dòng "Mua thêm … để miễn phí giao" tính trên tiền hàng sau giảm;
  - hộp 409 về mã có nút "Đặt không dùng mã" (gỡ mã, báo giá lại, đặt lại) và "Quay lại". Với `changed` chỉ có "Quay lại", vì báo giá mới đã hiện tiền giảm mới;
  - `OrderView` có dòng mã giảm giá.
- Test `api/test/checkout-voucher.test.ts` (14 test). `vouchers-admin.test.ts` (ticket 02) giờ dựng đơn có mã qua báo giá và đặt mua thật, vì check mới không cho gắn mã bằng `prisma`. Test gọi thẳng `customerRedemptions` đã bỏ, vì lượt mỗi khách nay được test qua HTTP.
- Chưa chạy thử trang đặt mua trên trình duyệt; E2E ở ticket 07.
