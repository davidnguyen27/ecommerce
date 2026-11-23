# Spec: M7 — Báo cáo

**Status:** resolved

Nguồn: `project-overview.md` (mục 2, 4, 6.1, 10.2), các mục Out of Scope ghi "M7" ở spec M2–M6b, và buổi làm rõ requirement ngày 2026-11-20 (21 câu, người dùng chấp nhận mọi đề xuất). Quyết định kiến trúc: `docs/adr/0016-doanh-thu-ghi-theo-ngay-giao.md` (mới), `docs/adr/0014-hoan-tien-la-truc-rieng.md`, `docs/adr/0015-doi-hang-khong-tao-don-moi.md`. Thuật ngữ mới trong GLOSSARY, mục **Báo cáo**: Doanh thu, Tiền thu, Hàng trả lại, Tồn đầu/Tồn cuối, Đơn đã xác nhận, Đơn bỏ dở.

## Problem Statement

Sau M6b, cửa hàng bán, thu tiền, hủy, hoàn và đổi trả được. Nhưng chủ doanh nghiệp không có chỗ nào trả lời các câu hỏi:
- tháng này bán được bao nhiêu, thương hiệu và sản phẩm nào bán chạy;
- đã thu bao nhiêu tiền, đã hoàn bao nhiêu, đang giữ bao nhiêu tiền cọc, khách còn nợ bao nhiêu;
- hàng nhập về, bán ra, hoàn về của từng SKU trong kỳ;
- mã giảm giá nào kéo được đơn;
- đơn hủy, hoàn tiền và đổi trả nhiều tới đâu, vì lý do gì;
- hôm nay có việc gì đang chờ quyết.

Muốn biết thì phải mở từng đơn rồi cộng tay. Tổng quan dự án yêu cầu "tổng hợp bán hàng, giao dịch, tiền cọc, số còn phải thu và đơn cần xử lý", và báo cáo phải tách cọc của đơn chưa giao khỏi giá trị đơn đã hoàn tất.

## Solution

Trang quản trị có thêm mục **Báo cáo** với 6 tab: Doanh thu, Tiền thu, Xuất nhập tồn, Mã giảm giá, Hủy & hoàn tiền, Đổi trả. Mỗi tab có bộ chọn khoảng ngày (giờ Việt Nam, mặc định tháng này), bảng số và nút xuất Excel. Trang chủ quản trị có thêm **bảng ngoại lệ** gom các việc đang chờ quyết, mỗi mục có link tới màn xử lý.

Doanh thu và tiền thu là hai trục riêng (ADR 0016). Mọi số đều tính trực tiếp từ bảng gốc mỗi lần xem, nên luôn khớp với màn đơn. Chỉ owner và kế toán xem được báo cáo.

## User Stories

### Chủ doanh nghiệp

1. Là chủ doanh nghiệp, tôi muốn xem doanh thu theo ngày hoặc tháng của một khoảng ngày, tách hàng sẵn và đặt trước, để biết cửa hàng bán được bao nhiêu.
2. Là chủ doanh nghiệp, tôi muốn xem doanh thu theo nhóm hàng, thương hiệu, và top sản phẩm/SKU theo doanh thu và số lượng.
3. Là chủ doanh nghiệp, tôi muốn thấy hàng trả lại trừ khỏi doanh thu, phí giao và mất cọc ở dòng riêng, để không nhầm chúng với tiền bán hàng.
4. Là chủ doanh nghiệp, tôi muốn thấy tiền thu theo ngày, chia theo trả đủ, tiền cọc và phần còn lại, trừ tiền đã hoàn.
5. Là chủ doanh nghiệp, tôi muốn biết lúc này cửa hàng đang giữ bao nhiêu tiền cọc, khách còn phải trả bao nhiêu, bao nhiêu tiền đang hoàn và bao nhiêu khoản đang chờ đối soát.
6. Là chủ doanh nghiệp, tôi muốn xem mỗi mã giảm giá được dùng bao nhiêu lượt, giảm bao nhiêu tiền và kéo được bao nhiêu tiền hàng.
7. Là chủ doanh nghiệp, tôi muốn biết tỷ lệ hủy đơn đã xác nhận theo lý do và hình thức bán, tách riêng các đơn bỏ dở.
8. Là chủ doanh nghiệp, tôi muốn biết tổng tiền và số khoản hoàn theo nguồn (hủy, đối soát, trả hàng) và theo trạng thái.
9. Là chủ doanh nghiệp, tôi muốn biết số yêu cầu trả và đổi theo lý do, nhóm hàng và kết quả, tỷ lệ trả theo nhóm hàng, và kết quả bảo hành.
10. Là chủ doanh nghiệp, ngay ở trang chủ quản trị, tôi muốn thấy các việc đang chờ:
    - đối soát đang mở;
    - hoàn tiền treo quá 3 ngày;
    - đơn quá hạn trả phần còn lại;
    - đơn đặt trước trễ hẹn;
    - yêu cầu hỗ trợ chưa ai nhận;
    - biến thể sắp hết.
11. Là chủ doanh nghiệp, tôi muốn xuất mỗi báo cáo ra Excel theo bộ lọc đang chọn.

### Kế toán, kho

12. Là kế toán, tôi muốn xem cùng các báo cáo như chủ doanh nghiệp, để đối chiếu tiền thu với sao kê.
13. Là kế toán, tôi muốn xem xuất nhập tồn của từng biến thể trong kỳ: tồn đầu, nhập, xuất bán, hàng hoàn về, điều chỉnh, tồn cuối. Lọc được theo nhóm hàng và thương hiệu.
14. Là nhân viên kho hay bán hàng không có quyền báo cáo, tôi vẫn thấy trang chủ quản trị như hiện nay, không thấy số tiền.

## Implementation Decisions

### Chung

- **Quyền mới `report.view`**, cấp cho owner (tự có qua `Permission.options`) và accountant. Mọi API báo cáo, bảng ngoại lệ và xuất Excel đều đòi quyền này.
- **API** dưới `/api/admin/reports/`: `revenue`, `collections`, `stock`, `vouchers`, `cancellations`, `returns`, `exceptions`. Chỉ đọc, không qua `audited()`, không ghi audit.
- **Kỳ:**
  - query `from`, `to` dạng `YYYY-MM-DD`, tính theo lịch Asia/Ho_Chi_Minh: từ 00:00 ngày `from` tới hết ngày `to`;
  - `groupBy` là `day` hoặc `month`;
  - `from > to` hoặc khoảng dài quá 366 ngày thì 400;
  - mặc định ở web là từ ngày 1 của tháng này tới hôm nay.

  Đổi kỳ sang mốc UTC và nhóm theo ngày/tháng VN ở một chỗ dùng chung (`api/src/reports/period.ts`). Nhóm trong SQL bằng `date_trunc(..., at time zone 'Asia/Ho_Chi_Minh')`.
- **Tính trực tiếp** từ bảng gốc (đơn, dòng đơn, sự kiện đơn, giao dịch, hoàn tiền, sổ xuất nhập, yêu cầu hỗ trợ) mỗi lần gọi. Không có bảng tổng hợp hay job. Truy vấn tổng hợp viết bằng `$queryRaw` khi Prisma không nhóm được. Chậm thì thêm index sau.
- **Tiền** trả về là số VND kiểu `number`, như các API khác.
- Schema request/response ở `shared/src/reports.ts`.

### Doanh thu (ADR 0016)

- **Đơn tính doanh thu:** đơn `completed`, có sự kiện `delivered`. Ngày giao là `createdAt` của sự kiện `delivered`; đơn hoàn tất chỉ có một sự kiện này.
- **Doanh thu gộp** của một dòng = `price × quantity − discount` của dòng. Của đơn = `subtotal − discount`.
- **Hàng trả lại** = tổng `amount` các khoản hoàn `origin = return`, `status = succeeded`, theo `completedAt`. Chỉ trừ ở bảng theo ngày/tháng, không chia xuống SKU, nhóm hàng hay thương hiệu.
- **Doanh thu thuần** = doanh thu gộp − hàng trả lại.
- **Phí giao** của các đơn tính doanh thu là cột riêng, không cộng vào doanh thu.
- **Mất cọc** là dòng riêng, không cộng vào doanh thu. Với đơn đặt trước bị hủy trong kỳ (theo `cancelledAt`): tổng giao dịch − tổng các khoản hoàn không `failed` của đơn, chỉ tính khi > 0. Đơn còn khoản hoàn chưa xong thì số này đã trừ phần đang hoàn.
- **Bảng theo kỳ**: ngày/tháng, số đơn đã giao, doanh thu gộp (tách hàng sẵn / đặt trước), hàng trả lại, doanh thu thuần, phí giao, mất cọc. Ô tổng ở đầu trang.
- **Bảng theo chiều** (cùng kỳ, chỉ doanh thu gộp và số lượng):
  - nhóm hàng;
  - thương hiệu;
  - top 50 SKU theo doanh thu (kèm tên sản phẩm chụp ở dòng đơn, số lượng).

  Thương hiệu và nhóm hàng lấy theo sản phẩm hiện tại của biến thể, qua `order_line.variant_id` → biến thể → sản phẩm. Dòng đơn không chụp hai thông tin này.
- Đổi hàng không ảnh hưởng doanh thu (ADR 0015).

### Tiền thu

- **Tiền vào** = tổng `payment_transaction.amount` theo `paidAt`, chia theo `purpose` (`full`, `deposit`, `remainder`). Giao dịch về sau khi đơn bị hủy (cần đối soát) vẫn là tiền vào. Khoản hoàn của nó trừ ở dòng tiền ra.
- **Tiền ra** = tổng `refund.amount` có `status = succeeded`, theo `completedAt`, chia theo `origin`.
- **Tiền thu thuần** = tiền vào − tiền ra. Bảng theo ngày/tháng có ô tổng.
- **Ô tại thời điểm xem** (không theo kỳ, không có lịch sử):
  - **Cọc đang giữ**: với đơn đặt trước chưa hủy, chưa giao (`fulfillmentStatus ≠ delivered`), tổng giao dịch − tổng hoàn đã xong;
  - **Còn phải thu**: tổng `remainingOf(order)` của đơn `DEPOSITED_PREORDER`. Đơn chưa trả gì không tính;
  - **Đang hoàn**: tổng và số khoản hoàn `pending` + `processing`;
  - **Cần đối soát**: số mục `open` và tổng số tiền của chúng.

### Xuất nhập tồn

- Mỗi biến thể có các cột:
  - **Tồn đầu**: `on_hand_after` của dòng sổ cuối cùng trước đầu kỳ (theo `seq`), không có thì 0;
  - **Nhập** = tổng `receipt` + `opening`;
  - **Xuất bán** = trị tuyệt đối tổng `sale` (gồm hàng đổi giao đi);
  - **Hàng hoàn về** = tổng `return` (gồm hàng hoàn sau giao thất bại và hàng khách trả hay đổi);
  - **Điều chỉnh tăng**, **Điều chỉnh giảm**: tổng `adjustment` dương và âm;
  - **Tồn cuối**: `on_hand_after` của dòng sổ cuối cùng tới hết kỳ.

  Bất biến được test: tồn đầu + nhập − xuất bán + hàng hoàn về + tăng − giảm = tồn cuối.
- **Biến thể hiện trong bảng** là biến thể có ít nhất một dòng sổ tới hết kỳ, kể cả không có biến động trong kỳ. Có tùy chọn "chỉ biến thể có biến động".
- Lọc theo nhóm hàng, thương hiệu. Sắp theo SKU. Phân trang 100 dòng. Có dòng tổng của toàn bộ kết quả lọc.
- Chỉ số lượng, không có giá trị tồn (không có giá vốn).

### Mã giảm giá

- **Đơn tính**: đơn có mã, tạo trong kỳ (theo `createdAt`), không bị hủy.
- Mỗi mã có:
  - mã, loại;
  - số lượt (số đơn chưa hủy);
  - tổng tiền giảm;
  - tiền hàng sau giảm của các đơn;
  - số đơn đã giao tính tới lúc xem.

  Sắp theo số lượt giảm dần.

### Hủy & hoàn tiền

- **Đơn đã xác nhận** (GLOSSARY): đơn tạo trong kỳ, có sự kiện `paid`, `deposit_paid` hoặc `restored`.
- **Tỷ lệ hủy** = số đơn đã xác nhận có `cancelCause` / số đơn đã xác nhận. Chia theo `cancelCause` và theo `kind`. Mẫu số bằng 0 thì hiện "—".
- **Đơn bỏ dở** (GLOSSARY): đơn tạo trong kỳ, đã hủy, không có `cancelCause`. Đếm theo `cancelReason` (`expired`, `customer`, `staff`), không đưa vào tỷ lệ hủy.
- **Hoàn tiền**: các khoản tạo trong kỳ, nhóm theo `origin` × trạng thái hiện tại, mỗi ô có số khoản và tổng tiền.

### Đổi trả

- **Yêu cầu tính**: yêu cầu `return` và `exchange` tạo trong kỳ.
- Bảng số yêu cầu theo loại × kết quả: chấp nhận, từ chối, chưa quyết.
- **Bảng dòng**: tổng số lượng theo lý do × nhóm hàng (nhóm hàng của sản phẩm của dòng đơn).
- **Tỷ lệ trả theo nhóm hàng** = tổng số lượng dòng của yêu cầu trả đã chấp nhận, tạo trong kỳ / tổng số lượng dòng của các đơn giao trong kỳ. Tử số và mẫu số không cùng tập đơn; trang ghi chú điều này. Mẫu số bằng 0 thì "—".
- **Bảo hành**: số yêu cầu `warranty` tạo trong kỳ, chia theo kết quả (`warrantyOutcome`, chưa có thì "đang xử lý").

### Bảng ngoại lệ

- `GET /api/admin/reports/exceptions`, không có kỳ, tính tại thời điểm xem. Mỗi mục có số đếm và tối đa 10 dòng đầu, kèm link:
  1. **Cần đối soát**: mục `open` → `/admin/reconciliation`.
  2. **Hoàn tiền treo**: khoản `pending` hoặc `processing` tạo quá 3 ngày → trang đơn.
  3. **Quá hạn phần còn lại**: `DEPOSITED_PREORDER` có `remainderOverdueAt` → trang đơn. Cùng điều kiện với `/api/admin/preorder-campaigns/attention`.
  4. **Đặt trước trễ hẹn**: đơn đặt trước chưa hủy, chưa giao, có `deliveryTo` trước hôm nay (giờ VN) → trang đơn.
  5. **Yêu cầu chưa ai nhận**: yêu cầu hỗ trợ chưa kết thúc, chưa có người phụ trách → trang yêu cầu.
  6. **Sắp hết hàng**: biến thể `active` của sản phẩm `published`, có tồn − giữ hàng ≤ 2 (kể cả 0) → trang tồn của biến thể. Ngưỡng là hằng số trong code.
- Ngưỡng 3 ngày và 2 cái là hằng số đặt tên ở `api/src/reports/`, đã chốt giữ nguyên (2026-11-23).

### Xuất Excel

- `GET /api/admin/reports/<báo cáo>.xlsx`, cùng query với API JSON, cùng quyền `report.view`. Không có cho bảng ngoại lệ.
- Dùng `exceljs` (đã có).
- Mỗi file có:
  - dòng đầu là tên báo cáo, kỳ và thời điểm xuất (giờ VN);
  - một sheet cho mỗi bảng của tab;
  - tiền và số lượng là ô số, định dạng `#,##0`;
  - tên file `bao-cao-<tab>-<from>-<to>.xlsx`.
- File không chứa tên, số điện thoại, email hay địa chỉ của khách, chỉ có số tổng, SKU, tên sản phẩm, mã giảm giá và mã đơn. Xuất xuất nhập tồn trả toàn bộ dòng, không phân trang.
- Không ghi audit.

### Web

- Mục menu **Báo cáo** (`/admin/reports`), chỉ hiện khi có `report.view`. Sáu tab là sáu route con, chung bộ chọn kỳ (từ ngày, tới ngày, nhóm theo ngày/tháng). Bộ chọn kỳ nằm trên query string để chia sẻ link được.
- Mỗi tab có ô số tổng ở đầu, các bảng, và nút "Xuất Excel". Không có biểu đồ.
- Trang chủ `/admin`: khối "Cần xử lý" hiện các mục ngoại lệ (số đếm, danh sách ngắn, link) khi có `report.view`. Người không có quyền này thấy trang chủ như hiện nay.

## Testing Decisions

- Test qua HTTP trên Postgres thật như các mốc trước. Dữ liệu dựng bằng các thao tác thật (đặt mua, cổng giả lập, bàn giao, đã giao, hủy, hoàn, trả hàng), không chèn thẳng vào bảng, trừ khi cần đặt thời điểm cụ thể. Prior art: `order-cancel-paid.test.ts`, `refunds.test.ts`, `stock.test.ts`.
- Các hành vi bắt buộc có test:
  - **Quyền:** không có `report.view` thì 403 ở mọi endpoint, kể cả `.xlsx`; accountant xem được.
  - **Kỳ:** đơn giao lúc 23:30 giờ VN ngày 31 thuộc ngày 31, không thuộc ngày hôm sau; `from > to` hay quá 366 ngày thì 400; nhóm theo tháng đúng.
  - **Doanh thu:**
    - chỉ đơn đã giao, theo ngày giao;
    - đơn đặt trước cọc kỳ này, giao kỳ sau thì tính vào kỳ sau;
    - phí giao và mất cọc không vào doanh thu;
    - khoản hoàn trả hàng trừ theo ngày hoàn xong, khoản chưa xong không trừ;
    - đổi hàng không đổi số;
    - tổng theo nhóm hàng/thương hiệu bằng doanh thu gộp.
  - **Tiền thu:**
    - giao dịch chia đúng mục đích;
    - hoàn thất bại hay đang chờ không trừ;
    - cọc đang giữ và còn phải thu đúng với một đơn đã cọc, một đơn đã về hàng, một đơn đã giao, một đơn đã hủy.
  - **Xuất nhập tồn:**
    - bất biến tồn đầu + biến động = tồn cuối với đủ năm loại sổ;
    - tồn đầu lấy đúng dòng trước kỳ;
    - lọc theo nhóm hàng, thương hiệu.
  - **Mã giảm giá:** đơn hủy không tính lượt; kỳ theo ngày tạo đơn.
  - **Hủy & hoàn:**
    - đơn hết hạn chưa trả là bỏ dở, không vào tỷ lệ hủy;
    - đơn đã trả bị hủy vào tỷ lệ theo đúng lý do;
    - hoàn tiền nhóm đúng nguồn × trạng thái.
  - **Đổi trả:** đếm theo lý do và nhóm hàng; tỷ lệ trả; mẫu số 0 trả `null`.
  - **Ngoại lệ:** mỗi mục có một ca vào và một ca không vào (hoàn mới 2 ngày không treo; tồn 3 không sắp hết; biến thể ngừng bán không vào).
  - **Excel:** trả đúng content type; mở lại bằng `exceljs` thấy ô số và dòng tiêu đề; không có email hay số điện thoại của khách.
- E2E: owner đăng nhập → mở Báo cáo → đổi kỳ → thấy doanh thu của một đơn đã giao → xuất Excel tải được file. Kế toán thấy menu Báo cáo, nhân viên kho không thấy.

## Out of Scope

- Giá vốn, lãi gộp, giá trị tồn (cần thêm giá nhập vào phiếu nhập và chọn cách tính; kế toán chốt, làm ở một mốc riêng).
- Tỷ lệ hoàn tất mua hàng (không có dữ liệu phiên thanh toán). Hiệu quả tư vấn AI (M8). Tỷ lệ giao đúng hẹn cho đơn hàng sẵn (không có lời hẹn).
- Biểu đồ; bảng tổng hợp hay job tính sẵn; lịch sử của cọc đang giữ và còn phải thu theo cuối kỳ.
- Tách VAT; tách phí gửi khỏi khoản hoàn trả hàng; chia hàng trả lại xuống SKU.
- Cấu hình ngưỡng ngoại lệ trên giao diện; email hay thông báo cho chủ doanh nghiệp.
- Báo cáo theo khách hàng, theo nhân viên, theo tỉnh/thành.

## Further Notes

- Buổi làm rõ 2026-11-20 chốt:
  - M7 gồm 6 báo cáo cùng bảng ngoại lệ, một mốc, không tách;
  - không làm giá vốn;
  - doanh thu và tiền thu là hai trục (ADR 0016);
  - doanh thu = tiền hàng sau giảm, phí giao và mất cọc để riêng, không tách VAT;
  - quyền `report.view` cho owner và accountant;
  - kỳ theo lịch VN, nhóm theo ngày hoặc tháng;
  - bảng và Excel, không có biểu đồ;
  - tính trực tiếp;
  - hàng trả lại trừ toàn bộ khoản hoàn `return`;
  - chiều doanh thu theo sản phẩm hiện tại;
  - cọc đang giữ và còn phải thu chỉ tại thời điểm xem;
  - tên cột tồn đầu/tồn cuối;
  - mã giảm giá theo ngày tạo đơn;
  - tỷ lệ hủy trên đơn đã xác nhận, đơn bỏ dở để riêng;
  - tỷ lệ trả theo nhóm hàng;
  - ngưỡng ngoại lệ cố định;
  - bảng ngoại lệ ở trang chủ admin;
  - Excel không có dữ liệu cá nhân.
- Trang chủ admin đã có số đếm (đơn, đối soát, đặt trước cần xử lý, yêu cầu chưa nhận) theo các quyền khác. Khối "Cần xử lý" bổ sung cho người có `report.view` và không bỏ các số đếm cũ.
- **Đã chốt (2026-11-23, người dùng thay chủ doanh nghiệp): giữ nguyên các số và nội dung dưới đây.**
  1. Định nghĩa doanh thu: ghi theo ngày giao, không gồm phí giao, mất cọc để riêng (ADR 0016).
  2. Ngưỡng "sắp hết" = còn bán được ≤ 2 cái.
  3. Hoàn tiền coi là "treo" sau 3 ngày chưa xong.
