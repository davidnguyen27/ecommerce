# Spec: Tách module đặt đơn

**Status:** resolved

Nguồn: buổi rà soát `api/src` bằng `/codebase-design` ngày 2026-11-24 (ứng viên #1), rồi thiết kế interface theo kiểu "design it twice" với ba phương án: interface tối thiểu, linh hoạt tối đa, tối ưu cho nơi gọi phổ biến. Spec này chọn phương án kết hợp được đề xuất ở cuối buổi. Đây là refactor: không đổi hành vi, không đổi contract API, không có migration, không có ADR mới. Quyết định liên quan: ADR 0007 (giữ hàng), ADR 0009 (ghi nhận tiền về), ADR 0012 và 0013 (đặt trước), ADR 0015 (đổi hàng không tạo đơn mới).

## Problem Statement

Hôm nay chỉ có hai nơi tạo **đơn hàng**: handler `POST /` của **đặt mua** ([checkout.ts](../../api/src/routes/checkout.ts), khoảng 170 dòng) và của **đặt trước** ([preorders.ts](../../api/src/routes/preorders.ts), khoảng 165 dòng). Hai handler chép nhau gần hết, gồm:

- đồng ý chính sách bảo mật, kiểm phường/xã;
- giới hạn số đơn chờ thanh toán;
- phiên bản chính sách bảo mật;
- áp mã giảm giá;
- tính phí giao và tổng;
- `order.create` với snapshot địa chỉ, hóa đơn, mã giảm giá và phiên bản chính sách;
- token tra cứu, sự kiện `created`, job hết hạn, địa chỉ giao gần nhất của khách;
- link thanh toán.

Phần thật sự khác nhau chỉ là cách lấy **dòng đơn**: đặt mua thì giữ hàng cho cả giỏ, đặt trước thì kiểm **suất** của đợt và tính **tiền cọc**.

Hệ quả:

- Mỗi thay đổi snapshot trên đơn (một cột mới, một quy tắc mới) phải sửa hai nơi. Sửa một nơi thì hai loại đơn lệch nhau mà không test nào báo.
- Các bất biến của việc tạo đơn chỉ được giữ bằng comment trong route, chép ở hai bản: một transaction, thứ tự khóa (email → SĐT → biến thể/suất → mã giảm giá), mã kiểm sau dòng, cọc tính sau giảm, link thanh toán gọi sau cùng.
- Route dính chặt vào nghiệp vụ. `enforcePendingOrderLimit` và `createOrderPaymentLink` nhận `req`/`res` của Express chỉ để đặt header `Retry-After`, lấy IP và log.
- Hai endpoint báo giá (`/quote`) cũng tự tính phí giao, tổng và tiền cọc theo quy tắc "ngưỡng miễn phí giao và cọc tính trên tiền hàng sau giảm" (spec M5). Quy tắc này được viết ba lần nữa.

## Solution

Tạo module `orderPlacement` trong `api/src/orders/`, có hai entry point đặt theo tên nghiệp vụ: `checkout` (đặt mua) và `preorder` (đặt trước). Route chỉ còn parse body, đếm giới hạn theo IP, gọi module rồi trả 201.

Bên trong là một pipeline cố định thứ tự các bước. Phần riêng của mỗi loại đơn nằm trong hai "plan" nội bộ, không export. Phí giao, tổng và tiền cọc tính bằng một hàm thuần `priceOrder`, dùng chung cho tạo đơn và hai endpoint báo giá.

Express ra khỏi seam. `AppError` mang `retryAfter`, `errorHandler` tự đặt header `Retry-After`. `createOrderPaymentLink` nhận `{ clientIp, log }` thay vì `req`.

## User Stories

Refactor không đổi gì khách hay nhân viên thấy. Các story dưới đây là của người bảo trì.

1. Là người bảo trì, tôi muốn thêm một trường snapshot cho đơn ở một nơi, để đơn đặt mua và đơn đặt trước không bao giờ lệch nhau.
2. Là người bảo trì, tôi muốn thứ tự khóa và quy tắc rollback của việc tạo đơn nằm trong một file, để đọc một lần là biết và không thể vô tình đảo.
3. Là người bảo trì, tôi muốn route đặt mua và đặt trước chỉ còn vài dòng, để đọc route là thấy contract HTTP chứ không phải nghiệp vụ.
4. Là người bảo trì, tôi muốn báo giá và tạo đơn dùng chung một hàm tính phí giao, tổng và tiền cọc, để số khách thấy lúc báo giá luôn khớp số trên đơn.
5. Là người bảo trì, tôi muốn module nghiệp vụ không nhận `req`/`res` của Express, để biết rõ nó cần gì từ request.
6. Là khách hàng, tôi muốn đặt mua và đặt trước chạy đúng như hôm nay: cùng mã lỗi, cùng thông điệp, cùng body 409, cùng header `Retry-After`.

## Implementation Decisions

### Interface của module

File `api/src/orders/place-order.ts`:

```ts
export type PlacementDeps = Pick<AppDeps, 'prisma' | 'payments' | 'siteUrl' | 'orderExpiry'>

/** Người đặt và các sự thật cần từ request; không có kiểu Express. */
export type Placer = {
  customerId: string | null // null = khách vãng lai
  clientIp: string          // gửi cổng thanh toán
  log: Logger               // log lỗi cổng trước khi ném 502
}

export function orderPlacement(deps: PlacementDeps): {
  /** Đặt mua: giữ hàng mọi dòng đơn, trả đủ tổng. */
  checkout(input: CheckoutRequest, placer: Placer): Promise<CheckoutResult>
  /** Đặt trước: một dòng, chiếm suất của đợt, trả tiền cọc. */
  preorder(input: PreorderRequest, placer: Placer): Promise<CheckoutResult>
}
```

- Input là kiểu **đã parse** (`CheckoutRequest`, `PreorderRequest` trong `@ecommerce/shared`). Route vẫn gọi `parse`, như mọi route khác.
- Có hai entry point thay vì một `place({ kind })`. Nơi gọi luôn biết mình đặt loại nào, và mỗi entry point có một kiểu lỗi 409 riêng.
- **Giới hạn theo IP (`checkoutPerIp`) ở lại route.** Nó phải chạy ngoài transaction, nếu không bộ đếm sẽ rollback cùng đơn hỏng. Thông điệp của nó cũng khác nhau theo route.

### Bất biến module bảo đảm (thuộc interface)

- **Một transaction** (`timeout: 30_000, maxWait: 10_000`). Bất kỳ lỗi nào cũng rollback toàn bộ: dòng sai, thiếu hàng hay hết suất, mã giảm giá sai, cổng thanh toán lỗi. Không còn đơn, hàng giữ, suất chiếm, lượt dùng, sự kiện, job hết hạn hay địa chỉ giao gần nhất nào.
- **Thứ tự các bước cố định.** Plan không đổi được thứ tự này:
  1. Kiểm trước khi đụng DB: đồng ý chính sách bảo mật khi là khách vãng lai, đồng ý chính sách đặt trước (với đặt trước), phường/xã thuộc tỉnh.
  2. Tạo token tra cứu, mở transaction, đọc cấu hình phí giao.
  3. `enforcePendingOrderLimit`: khóa advisory email rồi SĐT.
  4. Phiên bản chính sách bảo mật (khách vãng lai), 503 nếu chưa công bố. Với đặt trước thêm chính sách đặt trước, 503 nếu chưa công bố.
  5. **Claim** của plan: khóa dòng biến thể (`reserveStock`) hoặc dòng suất (`checkPreorder({ lock: true })`), dựng dòng đơn.
  6. `applyVoucherToOrder`: khóa dòng mã giảm giá, dùng các dòng ở bước 5.
  7. `priceOrder`: phí giao, tổng, tiền cọc, đều tính sau giảm.
  8. `order.create` với snapshot.
  9. Sự kiện `created`, `scheduleOrderExpiry`, `lastShippingAddress` (khách đăng nhập).
  10. `createOrderPaymentLink`, gọi **sau cùng**.
- **Snapshot trên đơn giữ nguyên như hôm nay:**
  - địa chỉ (tên tỉnh, tên phường), hóa đơn, ghi chú;
  - mã giảm giá (`voucherSnapshot`);
  - phiên bản chính sách bảo mật và phiên bản chính sách của sản phẩm (`livePolicyVersions`);
  - với đặt trước thêm phiên bản chính sách đặt trước và điều khoản của đợt (`depositPercent`, `depositAmount`, `deliveryFrom/To`, `remainderDays`).

### Lỗi (thuộc interface, giữ nguyên từng chữ)

- **400:** `acceptPrivacyPolicy`, `acceptPreorderPolicy`, `address.wardCode`. Thông điệp phân biệt "đặt mua" và "đặt trước".
- **429:** giới hạn đơn chờ thanh toán, kèm `retryAfter` (giây). Header `Retry-After` do `errorHandler` đặt.
- **503:** chính sách bảo mật hoặc chính sách đặt trước chưa công bố.
- **409, đặt mua:** `CheckoutConflictDetails`.
  - Gom **mọi** dòng sai trong một lần (`discontinued`, `price`, `out_of_stock`), sắp theo thứ tự dòng của input.
  - Vẫn giữ hàng các dòng đúng trước khi ném, để báo đủ các dòng thiếu hàng.
  - Lỗi của mã giảm giá trả `{ lines: [], voucher }`.
- **409, đặt trước:** `PreorderConflictDetails`.
  - Dừng ở thay đổi **đầu tiên** theo thứ tự ưu tiên hiện có: `discontinued`, `in_stock`, `campaign`, `price`, `deposit`, `sold_out`.
  - Thông điệp theo bảng `conflict()` hiện có, chuyển từ route vào module.
  - Lỗi của mã giảm giá trả `{ voucher }`.
- **502:** cổng thanh toán lỗi. Log qua `placer.log` rồi rollback.

### Bên trong module (không thuộc interface)

- **Plan đặt mua:**
  - `cartVariants`;
  - kiểm ngừng bán và giá;
  - `reserveStock` cho các dòng đúng, gom `out_of_stock`;
  - dựng dòng đơn với `reservedQuantity = quantity`;
  - tiền giảm từng dòng lấy từ `applied.lines`;
  - mục đích thanh toán `full`, số tiền là tổng.
- **Plan đặt trước:**
  - `checkPreorder({ lock: true })` và chuỗi 409 theo thứ tự ưu tiên;
  - đúng một dòng, dòng nhận toàn bộ tiền giảm như hôm nay;
  - cột đợt và tiền cọc;
  - thêm phiên bản chính sách đặt trước;
  - mục đích thanh toán `deposit`, số tiền là tiền cọc;
  - sự kiện thêm `depositAmount` và `campaignId`.
- Hai plan là cấu trúc nội bộ, **không phải seam**. Không export, nơi gọi chọn bằng entry point. Nếu `place-order.ts` dài quá khoảng 250 dòng thì tách `dat-mua.ts` và `dat-truoc.ts` cạnh nó, vẫn không export ra ngoài `orders/`.

### `priceOrder`

Hàm thuần trong `api/src/orders/price-order.ts`, không đụng DB:

```ts
priceOrder(
  config: ShippingFeeConfig,
  { subtotal, discount, provinceCode, depositPercent }:
    { subtotal: number; discount: number; provinceCode?: string; depositPercent?: number },
): { shippingFee: number | null; total: number | null; depositAmount: number | null }
```

- Ngưỡng miễn phí giao so với tiền hàng sau giảm, và tiền cọc tính trên tiền hàng sau giảm (spec M5).
- Thiếu `provinceCode` thì `shippingFee` và `total` là `null`. Thiếu `depositPercent` thì `depositAmount` là `null`.
- Nơi dùng:
  - pipeline tạo đơn;
  - giá trị "không mã" truyền cho `applyVoucherToOrder` (gọi với `discount: 0`);
  - `POST /api/checkout/quote` và `POST /api/preorders/quote`, gồm cả các trường `…WithoutVoucher`.
- Hai endpoint báo giá **không** dùng `orderPlacement`. Response của chúng khác nhau thật (`CheckoutQuote` báo trạng thái từng dòng, `PreorderQuote` có `offer`, `problem` và phần còn lại), không khóa gì, và cần `res` cho giới hạn dò mã.

### Thay đổi ngoài module

- **`AppError`:** thêm tham số tùy chọn `retryAfter?: number` (giây). `errorHandler` đặt `Retry-After` khi có giá trị này.
- **`enforcePendingOrderLimit`:** bỏ tham số `res`, ném `AppError` kèm `retryAfter`.
- **`enforceRateLimits`:** giữ nguyên chữ ký trong spec này, vì 13 nơi gọi khác không thuộc phạm vi. Ghi là việc tiếp theo trong Further Notes.
- **`createOrderPaymentLink`:**
  - nhận `{ payments, siteUrl, clientIp, log }` thay vì `{ payments, siteUrl, req }`;
  - việc bỏ tiền tố IPv4-mapped (`::ffff:`) chuyển vào trong hàm hoặc vào chỗ dựng `Placer`, chỉ một nơi;
  - `createRemainderLink` ([remainder.ts](../../api/src/preorders/remainder.ts)) đổi theo.
- **`routes/checkout.ts` và `routes/preorders.ts`:** handler `POST /` chỉ còn `parse`, giới hạn theo IP, dựng `Placer`, gọi module và trả 201. Các import không còn dùng bị xóa.

## Testing Decisions

- **Không viết test mới cho phần đã có test.** Test hiện có đi qua HTTP trên Postgres thật và là lưới an toàn của refactor: `checkout*.test.ts`, `preorder*.test.ts`, `payment-links.test.ts`, `admin-orders-voucher.test.ts`, `checkout-guards.test.ts` (429 và `Retry-After` của giới hạn đơn chờ). Mọi test phải xanh **mà không sửa test**. Phải sửa test là dấu hiệu hành vi đã đổi; dừng lại và ghi vào ticket.
- **Không gọi thẳng `orderPlacement` từ test.** CODING_STANDARDS mục "Test" yêu cầu đi qua HTTP khi có đường HTTP, và ở đây có. Dựng đơn trong test vẫn dùng `shop().checkout()` và các helper hiện có.
- **Thêm test HTTP** chỉ khi một ticket phát hiện hành vi chưa có test nào giữ mà refactor có thể làm vỡ. Ví dụ: header `Retry-After` của giới hạn đơn chờ ở route đặt trước, nếu chưa có.
- **Mỗi ticket chạy:** `pnpm --filter api test`, typecheck, lint. Ticket cuối chạy thêm `pnpm smoke` và E2E đặt mua và đặt trước.

## Out of Scope

- Đổi contract API, thông điệp lỗi, body 409, hay thứ tự kiểm lỗi.
- Gộp hai endpoint báo giá vào một module. Chỉ dùng chung `priceOrder`.
- Đổi `enforceRateLimits` sang `retryAfter` cho 13 nơi gọi còn lại.
- Khóa đơn và kiểm trạng thái dùng chung (ứng viên #2 của buổi rà soát) và email đơn hàng gom một chỗ (ứng viên #3).
- Đơn do nhân viên tạo và đơn đổi hàng. Hiện không có (ADR 0015), nên không chừa điểm mở rộng cho chúng.
- Test gọi thẳng module.

## Further Notes

- Ba phương án đã cân nhắc:
  - **A**, một `placeOrder` với union input: bị loại vì kiểu 409 bị trộn.
  - **B**, export `OrderKindPlan`: bị loại vì seam chỉ có hai giá trị cố định, nơi gọi không cần thay hành vi, và interface plan là phần dễ phải sửa nhất.
  - **C**, hai entry point: được chọn làm khung. Bỏ phần module tự `parse` và phần test gọi thẳng.
- Sau spec này, `enforceRateLimits` có thể bỏ `res` theo cùng cách. Khi đó `createRemainderLink` cũng thoát khỏi Express.
- Sửa khi triển khai (ticket 04): giới hạn theo IP chuyển vào module, đếm sau bước kiểm body và trước transaction, để giữ nguyên thứ tự "400 trước 429" của route cũ. `enforceRateLimits` vì vậy bỏ `res` ngay trong spec này. Mục Out of Scope về việc đó không còn đúng.
