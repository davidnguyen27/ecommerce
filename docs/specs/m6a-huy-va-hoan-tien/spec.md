# Spec: M6a — Hủy đơn đã nhận tiền, hoàn tiền, giao thất bại

**Status:** resolved

Nguồn: `docs/project-overview.md` (mục 2, 5, 6.1, 9, 10, 11), Out of Scope của spec M3 (`docs/specs/m3-mua-hang/spec.md`), M4 (`docs/specs/m4-dat-truoc/spec.md`) và M5 (`docs/specs/m5-ma-giam-gia/spec.md`), và buổi làm rõ requirement ngày 2026-11-17 (25 câu, người dùng chấp nhận mọi đề xuất). M6 trong lộ trình M0 → M8 được tách làm hai: **M6a** (spec này) lo tiền và hàng khi đơn không đi tới cuối; **M6b** lo đổi trả sau khi giao, bảo hành và yêu cầu hỗ trợ, và chạy trên nền của M6a. Quyết định kiến trúc: `docs/adr/0014-hoan-tien-la-truc-rieng.md` (mới), `docs/adr/0010-vnpay-thay-zalopay.md`, `docs/adr/0013-hang-ve-chia-cho-don-dat-truoc-trong-phieu-nhap.md`.

## Problem Statement

Sau M5, hệ thống chỉ hủy được đơn chưa thanh toán. Ba tình huống hằng ngày đều phải xử lý ngoài hệ thống, nên doanh nghiệp mất dấu tiền và hàng:

- Đơn đã trả tiền hoặc đã cọc không hủy được: khách đổi ý, nhà cung cấp không giao được hàng đặt trước, hay khách quá hạn trả phần còn lại.
- Tiền hoàn cho khách không được ghi ở đâu. Nhìn vào đơn không biết khách đã được hoàn bao nhiêu, hoàn bằng cách nào, đã tới tay khách chưa. Mục cần đối soát chỉ có cách đóng "Đã xử lý ngoài hệ thống".
- Đơn giao thất bại nằm treo ở "đang xử lý": không giao lại được, và hàng đơn vị vận chuyển trả về không vào lại được tồn.

## Solution

Nhân viên bán hàng **hủy** được cả một đơn đã nhận tiền (đã trả đủ hoặc đã cọc), khi hàng chưa bàn giao vận chuyển hoặc khi hàng giao thất bại đã được nhận hoàn về kho. Lúc hủy, nhân viên chọn lý do và **đề xuất số tiền hoàn**. Mặc định là toàn bộ số đã nhận; nhân viên được giảm xuống (ví dụ **mất cọc** khi khách đổi ý) nhưng phải ghi lý do. Hủy cả đơn thì trả lại lượt mã giảm giá và nhả hàng đang giữ; hàng đặt trước đã về thì chuyển cho đơn chờ kế tiếp.

**Hoàn tiền** là bản ghi riêng, theo dõi tới khi có kết quả (ADR 0014). Kế toán thực hiện hoàn theo một trong hai cách:

- chuyển khoản thủ công, rồi ghi mã giao dịch ngân hàng;
- gửi lệnh `refund` của VNPAY cho giao dịch gốc.

Khách nhận email khi đơn đã trả bị hủy và khi tiền đã hoàn. Trang đơn của khách hiện từng khoản hoàn. Mục cần đối soát giải quyết được bằng hoàn tiền.

Khi đợt đặt trước không nhập được hàng, một thao tác hủy mọi đơn đã cọc đang chờ hàng và tạo hoàn tiền đủ cho từng đơn.

Với đơn giao thất bại, nhân viên kho có hai lựa chọn:

- **giao lại**: mã vận đơn mới;
- **nhận hàng hoàn về**: từng dòng nhập lại tồn, hoặc ghi hỏng/mất.

## User Stories

### Khách hàng

1. Là khách hàng, khi đơn đã trả của tôi bị hủy, tôi muốn nhận email nói rõ lý do và số tiền sẽ được hoàn, để biết điều gì sẽ xảy ra.
2. Là khách hàng, tôi muốn trang đơn hàng (qua link tra cứu hoặc tài khoản) hiện đơn đã hủy, lý do, và từng khoản hoàn kèm trạng thái (đang hoàn, đã hoàn), để không phải gọi hỏi.
3. Là khách hàng, tôi muốn nhận email khi một khoản hoàn đã xong, để biết kiểm tài khoản.
4. Là khách đặt trước, khi doanh nghiệp không nhập được hàng, tôi muốn được hủy đơn và hoàn đủ tiền cọc.
5. Là khách hàng, khi đơn có mã giảm giá bị hủy, tôi muốn dùng lại được mã đó cho đơn sau.
6. Là khách hàng, khi giao thất bại, tôi muốn được giao lại mà không phải đặt đơn mới.

### Nhân viên bán hàng

7. Là nhân viên bán hàng, tôi muốn hủy một đơn đã trả đủ hoặc đã cọc khi hàng chưa bàn giao vận chuyển, chọn lý do (khách đổi ý, quá hạn trả phần còn lại, không nhập được hàng, giao thất bại, khác).
8. Là nhân viên bán hàng, lúc hủy tôi muốn thấy số đã nhận và đề xuất số hoàn, mặc định là toàn bộ; giảm xuống thì bắt buộc ghi lý do, để quyết định mất cọc hay khấu trừ phí được ghi lại.
9. Là nhân viên bán hàng, tôi muốn lý do "không nhập được hàng" luôn hoàn đủ.
10. Là nhân viên bán hàng, tôi muốn hủy đơn giao thất bại sau khi kho đã nhận hàng hoàn về.
11. Là nhân viên bán hàng, khi đợt đặt trước không nhập được hàng, tôi muốn hủy một lần mọi đơn đã cọc chưa có hàng về của đợt, mỗi đơn có hoàn tiền đủ và email cho khách.
12. Là nhân viên bán hàng, khi tôi hủy một đơn đặt trước đã có hàng về, tôi muốn hàng đó chuyển cho đơn chờ kế tiếp theo thứ tự cọc, để giữ lời hứa với khách cọc sau.
13. Là nhân viên bán hàng, khi tôi hủy một đơn đặt trước chưa có hàng về, tôi muốn suất của đơn trả lại cho đợt.

### Nhân viên kho

14. Là nhân viên kho, với đơn giao thất bại, tôi muốn ghi một lần giao lại với đơn vị vận chuyển và mã vận đơn mới.
15. Là nhân viên kho, tôi muốn ghi nhận hàng hoàn về theo từng dòng: bao nhiêu cái nhập lại tồn, bao nhiêu cái hỏng hoặc mất, để tồn khớp với hàng thực có.
16. Là nhân viên kho, sau khi hàng đã hoàn về, tôi muốn giao lại được nếu khách vẫn muốn nhận, và hệ thống giữ lại hàng cho đơn như lúc mới đặt.

### Kế toán, chủ doanh nghiệp

17. Là kế toán, tôi muốn danh sách đơn có bộ lọc "hoàn tiền chưa xong".
18. Là kế toán, tôi muốn thực hiện một khoản hoàn bằng lệnh hoàn của VNPAY, hoặc ghi lại một lần chuyển khoản thủ công (mã giao dịch ngân hàng, ngày chuyển, ghi chú).
19. Là kế toán, khi VNPAY trả "đang xử lý", tôi muốn tự đánh dấu đã hoàn hoặc thất bại sau khi kiểm trên cổng merchant.
20. Là kế toán, khi một khoản hoàn thất bại, tôi muốn tạo lại khoản hoàn đó.
21. Là kế toán, tôi muốn giải quyết một mục cần đối soát (tiền về sau khi hủy, trả thừa, lệch số tiền) bằng cách hoàn số tiền đó.
22. Là kế toán, tôi muốn chi tiết đơn hiện đã nhận, đã hoàn, đang hoàn, để không hoàn quá tay.
23. Là chủ doanh nghiệp, tôi muốn người quyết hủy (bán hàng) và người chuyển tiền (kế toán) là hai quyền khác nhau.
24. Là chủ doanh nghiệp, tôi muốn mọi thao tác hủy, hoàn, giao lại, nhận hàng hoàn về có trong audit log.

## Implementation Decisions

### Hủy đơn đã nhận tiền

- Hủy được khi: đơn `processing`, thanh toán `deposit_paid` hoặc `paid`, và giao hàng là `not_prepared`, `preparing` hoặc `returned` (mới, xem phần giao thất bại). Sai điều kiện thì 409. Không hủy được sau `handed_over` hay `delivered`, và không hủy được ở `failed` khi kho chưa ghi nhận hàng hoàn về.
- Hủy luôn là cả đơn. `cancel_reason` là `staff` như M3. Đơn thêm `cancel_cause` (enum `changed_mind`, `remainder_overdue`, `supply_failed`, `delivery_failed`, `other`) và `cancel_note`, có khi và chỉ khi đơn bị hủy lúc đã nhận tiền (check DB).
- Trong một transaction qua `audited()` (action `order.cancel_paid`):
  1. khóa đơn `FOR UPDATE` (dùng lại `lockForTransition`);
  2. nhả hàng đang giữ:
     - hàng sẵn dùng `releaseStock`;
     - đơn đặt trước có `reserved_quantity > 0` thì phần đó chia lại cho các đơn đặt trước đang chờ cùng biến thể theo thứ tự cọc, cùng quy tắc với `planArrivals`/`applyArrivals` (ADR 0013); phần dư thành hàng sẵn. Đơn chờ nào nhờ vậy về đủ thì thành hàng đã về như khi có phiếu nhập: hạn trả phần còn lại và email "Hàng đã về".
     - đơn `returned` không còn hàng giữ;
  3. đặt đơn `cancelled`, `cancelled_at`, `cancel_cause`, `cancel_note`; thêm sự kiện đơn;
  4. tạo **một** hoàn tiền `pending` với số tiền đề xuất, nếu số đó > 0;
  5. xếp email "Đơn đã hủy" cho khách.
- Số đề xuất nằm trong [0, **số có thể hoàn**]:
  - mặc định bằng số có thể hoàn;
  - nhỏ hơn thì `cancel_note` bắt buộc (400 nếu thiếu);
  - `cancel_cause = supply_failed` thì phải bằng số có thể hoàn (400 nếu khác).
- **Số có thể hoàn** của đơn = tổng `payment_transaction.amount` của đơn − tổng hoàn tiền không ở trạng thái `failed`.
- Lượt mã giảm giá tự trống vì lượt tính trên đơn chưa `cancelled` (M5). Suất của đợt cũng tự trống vì suất tính trên đơn chưa hủy (M4). Không cần code thêm cho hai việc này, chỉ cần test.
- Hủy đơn chưa thanh toán (M3/M4) giữ nguyên endpoint, quyền và hành vi.

### Hủy hàng loạt khi đợt không nhập được hàng

- `POST /api/admin/preorder-campaigns/:id/cancel-unsupplied` (cần cả `order.cancel_paid` và `preorder.manage`, body có `note` bắt buộc). Trong một transaction:
  1. đóng đợt nếu đợt đang mở;
  2. hủy mọi đơn của đợt đang `processing` + `deposit_paid` mà chưa có hàng về (`arrived_at` trống), với `cancel_cause = supply_failed` và hoàn tiền đủ;
  3. phần hàng đã giữ một phần của các đơn này thành hàng sẵn, không chia lại cho đơn nào trong đợt;
  4. xếp email cho từng khách.
- Đơn đã có hàng về hoặc đã trả đủ không bị hủy theo thao tác này. Kết quả trả về danh sách mã đơn đã hủy. Audit log ghi một dòng cho thao tác và một dòng cho mỗi đơn.

### Hoàn tiền (ADR 0014)

- Bảng `refund`:
  - id, `order_id`;
  - `amount` (> 0);
  - `origin` (`cancellation`, `reconciliation`, `retry`), cùng id mục đối soát hoặc id hoàn tiền thất bại được tạo lại;
  - `status`: `pending` → `processing` → `succeeded`, hoặc `failed`;
  - `method`: `vnpay` hoặc `manual`, trống khi còn `pending`;
  - `payment_transaction_id`: chỉ có với `vnpay`;
  - với `manual`: `bank_reference`, `transferred_on`;
  - `note`;
  - `gateway_payload` (JSONB);
  - người tạo, người thực hiện, người chốt;
  - `created_at`, `completed_at`.
- Check DB: `method` có khi và chỉ khi không `pending`; `payment_transaction_id` có khi và chỉ khi `method = vnpay`; `completed_at` có khi và chỉ khi `succeeded` hoặc `failed`.
- Tổng hoàn tiền không `failed` của một đơn không vượt tổng đã nhận. Kiểm ở tầng ứng dụng dưới khóa đơn `FOR UPDATE`, giống mọi chỗ ghi tiền khác.
- **Thực hiện thủ công** (`payment.refund`): `pending` → `succeeded` một bước, kèm `bank_reference`, `transferred_on`, ghi chú tùy chọn. Hệ thống không lưu số tài khoản của khách.
- **Thực hiện qua VNPAY** (`payment.refund`):
  - Hệ thống chia số tiền theo các giao dịch VNPAY của đơn, lấy giao dịch mới nhất trước. Mỗi giao dịch chỉ nhận tới phần chưa hoàn của nó.
  - Nếu phải chia cho nhiều giao dịch, hoàn tiền `pending` được tách thành nhiều bản ghi, mỗi bản ghi một giao dịch, trong cùng transaction trước khi gọi cổng.
  - Gọi `refund`: loại `02` khi hoàn đủ giao dịch, `03` khi hoàn một phần; `vnp_CreateBy` là id nhân viên, không phải email.
  - Kết quả:
    - `00` kèm trạng thái giao dịch `00` → `succeeded`;
    - `00` kèm `05`/`06`, hoặc mã `94` → `processing`;
    - mã khác → `failed`, lưu lý do.
  - Không có job theo dõi. Kế toán đánh dấu `processing` → `succeeded` hoặc `failed` bằng tay, ghi chú bắt buộc.
  - Giao dịch không phải của VNPAY (ví dụ nguồn `simulator` trên bản deploy) chỉ hoàn thủ công được.
- **Tạo lại** (`payment.refund`): từ một hoàn tiền `failed`, tạo hoàn tiền `pending` mới với số tiền ≤ số của khoản thất bại và ≤ số có thể hoàn. `origin = retry`.
- Gửi email "Đã hoàn tiền" khi một hoàn tiền chuyển sang `succeeded`.
- `PaymentGateway` thêm `refund(...)`, trả `succeeded | processing | rejected` kèm payload.
  - `InMemoryPaymentGateway` cho test đặt trước kết quả.
  - `SimulatorPaymentGateway` chọn kết quả theo chữ số cuối của số tiền: `1` → `processing`, `2` → `rejected`, còn lại → `succeeded`.
  - Adapter VNPAY ký theo thứ tự trường của tài liệu `querydr&refund` (kiểm lại thuật toán hash ở trang đổi thuật toán của VNPAY khi làm ticket).
  - Endpoint production và hạn hoàn của VNPAY chưa có trong tài liệu sandbox: ticket VNPAY ghi lại khi kiểm.
- **Trạng thái thanh toán của đơn không đổi** (ADR 0014). Chi tiết đơn ở trang quản trị và trang của khách trả thêm `received`, `refunded` (tổng `succeeded`), `refunding` (tổng `pending` + `processing`) và danh sách hoàn tiền. Khách chỉ thấy số tiền, trạng thái (đang hoàn, đã hoàn) và ngày, không thấy ghi chú nội bộ hay mã ngân hàng.

### Đối soát

- Thêm cách giải quyết `refunded` cho mục cần đối soát (`payment.reconcile`): tạo hoàn tiền `pending`, `origin = reconciliation`, số tiền bằng số tiền của mục, rồi đóng mục với `resolution = refunded`. Kiểm số có thể hoàn như trên. Audit action `reconciliation.refund`.
- Hai cách giải quyết cũ giữ nguyên.

### Giao thất bại

- Trạng thái giao hàng thêm `returned` (hàng đã nhận hoàn về). Các cạnh mới:
  - `failed` → `handed_over` (**giao lại**);
  - `failed` → `returned` (**nhận hàng hoàn về**);
  - `returned` → `not_prepared` (**giao lại từ kho**);
  - `returned` → hủy đơn như trên.
- **Giao lại** (`order.fulfill`): nhập đơn vị vận chuyển và mã vận đơn mới, `handed_over_at` mới. Mã vận đơn cũ chỉ còn trong sự kiện đơn và audit. Không đổi tồn, không thu thêm tiền, không gửi email.
- **Nhận hàng hoàn về** (`order.fulfill`):
  - Với mỗi dòng đơn, nhập số nhập lại tồn và số hỏng/mất; tổng hai số bằng số lượng của dòng (400 nếu khác).
  - Phần nhập lại tồn đi qua `changeStock` với loại biến động mới `return`, dòng sổ trỏ về đơn (sửa check `stock_movement_order_check` thành `kind IN ('sale', 'return')`).
  - Phần hỏng/mất không ghi sổ, vì hàng đã rời tồn lúc bàn giao. Số này lưu trên dòng đơn (`returned_quantity`, `written_off_quantity`) để M6b và M7 đọc được.
  - Không hủy đơn, không hoàn tiền.
- **Giao lại từ kho** (`order.fulfill`):
  - Giữ hàng lại cho mọi dòng như lúc đặt mua (`reserveStock`); không đủ thì 409. Xóa đơn vị vận chuyển, mã vận đơn và `handed_over_at`, rồi đơn đi lại luồng chuẩn bị → bàn giao như M3.
  - Đơn đặt trước cũng làm vậy: hàng đã thành hàng sẵn khi nhập lại tồn, nên giữ hàng từ tồn như đơn hàng sẵn.
- Check `order_handover_check` thêm `returned` vào nhóm *chưa bàn giao* (không có đơn vị vận chuyển và mã vận đơn).

### Quyền

- Mới: `order.cancel_paid` (owner, sales) cho hủy đơn đã nhận tiền và hủy hàng loạt. Mới: `payment.refund` (owner, accountant) cho thực hiện, chốt và tạo lại hoàn tiền.
- Hủy đơn chưa trả vẫn cần `order.fulfill` như M3. Giao lại, nhận hàng hoàn về, giao lại từ kho cần `order.fulfill`. Giải quyết đối soát bằng hoàn tiền cần `payment.reconcile`.
- Audit action: `order.cancel_paid`, `preorder_campaign.cancel_unsupplied`, `refund.execute_manual`, `refund.execute_vnpay`, `refund.settle`, `refund.retry`, `reconciliation.refund`, `order.redeliver`, `order.return_to_stock`, `order.restock_redeliver`.

### API quản trị

- `POST /api/admin/orders/:code/cancel-paid` với body `{ cause, refundAmount, note? }`.
- `POST /api/admin/orders/:code/redeliver`, `/return-to-stock`, `/restock-redeliver`.
- `POST /api/admin/refunds/:id/manual`, `/vnpay`, `/settle` (`succeeded` hoặc `failed` + ghi chú), `/retry`.
- `POST /api/admin/reconciliation/:id/refund`.
- `POST /api/admin/preorder-campaigns/:id/cancel-unsupplied`.
- Danh sách đơn thêm bộ lọc `refund=open`: có hoàn tiền `pending` hoặc `processing`.

### Email

Hai email mới, theo mẫu email hiện có:

- **Đơn đã hủy**: mã đơn, lý do theo cách nói với khách, số tiền sẽ hoàn (hoặc không hoàn, kèm lời nhắc chính sách đặt trước), lời mời liên hệ.
- **Đã hoàn tiền**: mã đơn, số tiền, ngày.

Không có email khi giao thất bại hay giao lại. Nội dung đã chốt giữ nguyên (2026-11-23).

### Web

- **Khách:** trang đơn hàng (token và tài khoản) hiện đơn đã hủy kèm lý do, khối "Hoàn tiền" (đã nhận, từng khoản: số tiền, đang hoàn hay đã hoàn, ngày). Không có nút mới cho khách.
- **Admin, chi tiết đơn:**
  - Nút "Hủy đơn" cho đơn đã nhận tiền (khi có `order.cancel_paid`), mở hộp thoại: lý do, số đã nhận, ô số hoàn mặc định toàn bộ, ghi chú bắt buộc khi giảm, xác nhận.
  - Khối "Hoàn tiền" liệt kê các khoản; khi có `payment.refund` thì có nút "Hoàn qua VNPAY", "Ghi chuyển khoản", "Đánh dấu đã hoàn/thất bại", "Tạo lại".
  - `AdminFulfillmentPanel` ở `failed` có "Giao lại" và "Nhận hàng hoàn về" (form từng dòng); ở `returned` có "Giao lại từ kho".
- **Admin, danh sách đơn:** bộ lọc "Hoàn tiền chưa xong".
- **Admin, trang đối soát:** nút "Hoàn tiền".
- **Admin, chi tiết đợt đặt trước:** nút "Hủy các đơn chờ hàng (không nhập được)", có hộp xác nhận ghi số đơn sẽ bị hủy và tổng tiền sẽ hoàn.

## Testing Decisions

- Test kiểm hành vi bên ngoài qua HTTP như M3–M5, trên Postgres thật, cổng thanh toán giả trong bộ nhớ. Prior art: `admin-orders` cancel/fulfill tests, `reconciliation.test.ts`, `preorder-arrivals` tests, `preorder-deposit.test.ts`, `vouchers` tests. Adapter VNPAY `refund` có unit test riêng cho chữ ký và ánh xạ mã phản hồi, như adapter thanh toán hiện có.
- E2E:
  - nhân viên hủy một đơn hàng sẵn đã trả, rồi kế toán ghi chuyển khoản; trang đơn của khách hiện đã hoàn;
  - một đơn giao thất bại → nhận hàng hoàn về → hủy → hoàn qua cổng giả lập.
  - Thêm hủy hàng loạt đợt đặt trước nếu chạy lại được trên cùng stack (khác với ghi chú `preorder.spec` ở M5).
- Các hành vi bắt buộc có test:
  - **Hủy đơn đã nhận tiền:** đúng các trạng thái cho phép, sai thì 409; hàng giữ được nhả; lượt mã giảm giá trống lại; suất đợt trống lại; số hoàn > số có thể hoàn thì 400; số hoàn < mặc định mà thiếu ghi chú thì 400; `supply_failed` với số hoàn khác số có thể hoàn thì 400; số hoàn 0 thì không tạo hoàn tiền; thiếu `order.cancel_paid` thì 403; sales hủy được, warehouse không; hai yêu cầu hủy song song thì đúng một thành công.
  - **Chia lại hàng đặt trước:** hủy đơn đã về chuyển hàng cho đơn chờ kế tiếp theo thứ tự cọc; đơn đó về đủ thì có hạn trả và email; không còn đơn chờ thì thành hàng sẵn; giữ một phần cũng chia đúng.
  - **Hủy hàng loạt:** chỉ hủy đơn đã cọc chưa về; đơn đã về và đơn đã trả đủ không đổi; mỗi đơn có hoàn tiền đủ; đợt bị đóng; thiếu một trong hai quyền thì 403.
  - **Hoàn tiền:** thủ công `pending` → `succeeded`; VNPAY với từng kết quả của cổng giả; chia theo giao dịch mới nhất trước khi đơn đặt trước có hai giao dịch; không hoàn vượt phần chưa hoàn của một giao dịch; chốt `processing`; tạo lại từ `failed`; tổng không `failed` không vượt đã nhận kể cả khi hai yêu cầu song song; email khi `succeeded`; thiếu `payment.refund` thì 403; sales không thực hiện được.
  - **Đối soát:** giải quyết bằng hoàn tiền tạo đúng số tiền và đóng mục; mục đã đóng thì 409.
  - **Giao thất bại:** giao lại đổi mã vận đơn, không đổi tồn; nhận hàng hoàn về ghi `return` vào sổ đúng số nhập lại, không ghi phần hỏng/mất; tổng hai số sai thì 400; giao lại từ kho giữ lại hàng hoặc 409 khi thiếu; hủy ở `failed` thì 409, ở `returned` thì được và không nhả hàng.
  - **Khách:** trang đơn hiện lý do hủy và các khoản hoàn, không lộ ghi chú nội bộ hay mã ngân hàng.
  - **Migration:** đơn cũ thỏa các check mới.

## Out of Scope

- Đổi trả sau khi giao, yêu cầu bảo hành, yêu cầu hỗ trợ của khách, hoàn tiền một phần cho một dòng đã giao (M6b).
- Khách tự hủy hay gửi yêu cầu hủy đơn đã trả (M6b, qua yêu cầu hỗ trợ).
- Hủy một phần đơn.
- Job theo dõi kết quả hoàn qua `querydr`; hoàn tự động không cần kế toán.
- Hệ thống tự tính mất cọc theo quy tắc; tự hủy đơn quá hạn trả phần còn lại.
- Thu thêm phí khi giao lại; đòi bồi thường đơn vị vận chuyển.
- Lưu số tài khoản ngân hàng của khách.
- Báo cáo hoàn tiền, tỷ lệ hủy (M7).

## Further Notes

- GLOSSARY: sửa **Hủy đơn** (không còn giới hạn ở đơn chưa thanh toán; chỉ nhân viên hủy đơn đã nhận tiền; không hủy một phần) và **Lượt dùng** (trả lượt khi hủy cả trước lẫn sau thanh toán). Thêm **Hoàn tiền**, **Mất cọc**, **Giao thất bại**, **Giao lại**, **Nhận hàng hoàn về**.
- Buổi làm rõ 2026-11-17 chốt:
  - tách M6 thành M6a và M6b;
  - hoàn tiền tách khỏi hủy đơn;
  - thủ công trước, VNPAY là phần thêm;
  - chỉ nhân viên hủy đơn đã trả, sau bàn giao thì không hủy;
  - hủy cả đơn, hoàn được một phần;
  - nhân viên quyết mất cọc theo lý do; "không nhập được hàng" thì hoàn đủ;
  - giao lại và nhận hàng hoàn về;
  - trả lượt mã giảm giá khi hủy cả đơn;
  - hoàn làm hai bước (bán hàng đề xuất, kế toán thực hiện);
  - hoàn qua VNPAY theo giao dịch, mới nhất trước;
  - không có job `querydr`;
  - không thêm trạng thái thanh toán;
  - mặc định hoàn đủ, giảm phải ghi lý do;
  - hàng đặt trước nhả ra đi cho đơn chờ kế tiếp;
  - đối soát giải quyết bằng hoàn tiền;
  - email khi hủy và khi hoàn xong;
  - quyền `order.cancel_paid` và `payment.refund`;
  - hủy sau giao thất bại phải chờ hàng hoàn về;
  - trả suất cho đợt;
  - hủy hàng loạt khi không nhập được hàng;
  - không lưu số tài khoản;
  - ADR 0014;
  - giao lại không thu thêm;
  - cổng giả lập hỗ trợ hoàn.
- Khi viết spec, đã thêm một chi tiết so với buổi làm rõ: hàng ghi "hỏng/mất" lúc nhận hàng hoàn về **không** ghi vào sổ xuất nhập, vì hàng đã rời tồn từ lúc bàn giao. Chỉ phần nhập lại tồn mới ghi sổ.
- **Đã chốt (2026-11-23, người dùng thay chủ doanh nghiệp): giữ nguyên các số và nội dung dưới đây.**
  1. Nội dung hai email: đơn đã hủy, và đã hoàn tiền.
  2. Mức mất cọc theo từng lý do, ghi vào trang chính sách đặt trước (`chinh-sach-dat-truoc`).
  3. Khi giao thất bại do khách, có khấu trừ phí giao vào số hoàn không.
- Cần kiểm khi làm ticket VNPAY: thuật toán hash của lệnh `refund`, endpoint production, hạn được hoàn, có được hoàn một phần nhiều lần trên một giao dịch không, và sandbox có chạy lệnh `refund` không. Nếu sandbox không chạy được thì ghi vào ADR 0014 và giữ đường thủ công.
