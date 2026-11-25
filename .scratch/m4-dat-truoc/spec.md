# Spec: M4 — Đặt trước và đặt cọc

**Status:** resolved

Nguồn: `docs/project-overview.md` (mục 3.2, 4, 5.2, 5.3, 5.4, 5.5, 6.1), Out of Scope của spec M3 (`.scratch/m3-mua-hang/spec.md`) và buổi làm rõ requirement ngày 2026-11-14 (23 câu, người dùng chấp nhận mọi đề xuất). Đây là mốc thứ tư trong lộ trình M0 → M8 của giai đoạn 1 (mở bán). Quyết định kiến trúc: `docs/adr/0012-dat-truoc-nam-ngoai-gio-hang.md`, `docs/adr/0013-hang-ve-chia-cho-don-dat-truoc-trong-phieu-nhap.md`; giữ hàng theo `docs/adr/0007-giu-hang-khong-tru-ton-hang-roi-ton-khi-ban-giao.md`.

## Problem Statement

Sau M3, khách mua được hàng có sẵn, nhưng gặp biến thể hết hàng thì chỉ thấy "Hết hàng". Doanh nghiệp hiện nhận đặt hàng nhập qua tin nhắn: họ ghi tay ai đã chuyển cọc bao nhiêu, hứa giao lúc nào, và khi hàng về thì nhắn từng người để thu phần còn lại. Không có nơi nào cho biết đã nhận bao nhiêu suất của một lần nhập, ai cọc trước, hay đơn nào đã có hàng nhưng khách chưa trả nốt. Khi hàng về, kho cộng tồn, website hiện "còn hàng", và khách khác có thể mua mất phần đã hứa cho người đã cọc.

## Solution

Nhân viên bán hàng mở một **đợt đặt trước** cho một sản phẩm, gồm các biến thể nhận đặt, số **suất** của từng biến thể, mức cọc (tỷ lệ phần trăm), thời gian giao dự kiến, hạn đóng nhận đặt và hạn trả phần còn lại. Khi một biến thể hết hàng sẵn mà đợt đang mở và còn suất, trang sản phẩm hiện "Đặt trước" thay cho "Hết hàng". Khách đặt trước ngay từ trang sản phẩm, không qua giỏ hàng. Trước khi trả, khách thấy tổng tiền, tiền cọc, phần còn lại, thời gian giao dự kiến và chính sách đặt trước. Sau đó khách trả cọc qua VNPAY.

Nhân viên cập nhật tiến độ nhập hàng của đợt, và mỗi lần thời gian giao dự kiến thay đổi thì khách đã cọc nhận email. Khi kho ghi phiếu nhập, hàng về được chia ngay cho các đơn đã cọc theo thứ tự cọc. Đơn nào được giữ đủ hàng thì khách nhận email "Hàng đã về" kèm link trả phần còn lại trong số ngày đã công bố. Trả đủ thì đơn đi tiếp luồng soạn hàng, bàn giao và giao như M3. Quá hạn thì đơn được đưa vào danh sách cần xử lý cho nhân viên.

Mốc này **chưa hủy được đơn đã cọc và chưa hoàn tiền** (M6), **chưa có voucher** (M5), và **giỏ hàng vẫn chỉ chứa hàng sẵn** (ADR 0012).

## User Stories

### Khách hàng: xem và đặt trước

1. Là khách hàng, tôi muốn thấy biến thể hết hàng nhưng đang nhận đặt trước được ghi là "Đặt trước", kèm mức cọc và thời gian giao dự kiến, để biết vẫn mua được.
2. Là khách hàng, tôi muốn biến thể còn hàng sẵn chỉ hiện "Mua ngay", để không phải phân vân giữa hai lựa chọn cho cùng một món.
3. Là khách hàng, tôi muốn thẻ sản phẩm có nhãn "Đặt trước" khi sản phẩm không còn hàng sẵn nhưng có biến thể đang nhận đặt, để biết trước khi mở trang.
4. Là khách hàng, tôi muốn biến thể đã hết suất, hoặc thuộc đợt đã đóng, hiện "Hết hàng", để không đặt vào thứ không còn nhận.
5. Là khách hàng, tôi muốn bấm "Đặt trước" để vào thẳng trang đặt trước của biến thể đó, chọn 1–5 cái, nhập thông tin nhận hàng, để không phải qua giỏ hàng.
6. Là khách hàng, trước khi trả tiền, tôi muốn thấy tiền hàng, phí giao, tổng phải trả, tiền cọc cần trả ngay, phần còn lại, thời gian giao dự kiến, hạn trả phần còn lại sau khi hàng về, và chính sách đặt trước, để hiểu rõ điều kiện.
7. Là khách vãng lai, tôi muốn đặt trước mà không cần đăng nhập và tra cứu đơn qua link trong email, giống khi mua hàng sẵn.
8. Là khách hàng, tôi muốn được báo rõ nếu giá, mức cọc, tình trạng hàng hay số suất đã đổi lúc tôi xác nhận, để không bị thu khác điều tôi đã thấy.
9. Là khách hàng, tôi muốn được báo "Đã có hàng sẵn, hãy mua ngay" nếu biến thể vừa có hàng trong lúc tôi đặt trước, để không phải cọc rồi chờ.

### Khách hàng: cọc và phần còn lại

10. Là khách hàng, tôi muốn trả cọc qua VNPAY trong 15 phút như khi mua hàng sẵn, quá hạn thì đơn tự hủy và nhả suất.
11. Là khách hàng, tôi muốn nhận email xác nhận đã nhận cọc, kèm số tiền còn lại và thời gian giao dự kiến.
12. Là khách hàng, tôi muốn nhận email mỗi khi thời gian giao dự kiến của đợt thay đổi, để không phải tự hỏi.
13. Là khách hàng, tôi muốn nhận email "Hàng đã về" kèm link trả phần còn lại và hạn trả, khi hàng của đơn tôi đã về đủ.
14. Là khách hàng, tôi muốn nhận email nhắc hai ngày trước hạn trả phần còn lại.
15. Là khách hàng, tôi muốn trả phần còn lại từ trang đơn hàng (qua link tra cứu hoặc tài khoản), và nếu lần trả không thành công thì thử lại được mà đơn không bị hủy.
16. Là khách hàng, tôi muốn trang đơn hàng hiện riêng tiền đã cọc, phần còn lại, thời gian giao dự kiến, hàng đã về chưa và hạn trả, để biết "đã cọc" khác "đã trả đủ".
17. Là khách hàng, tôi muốn hủy được đơn đặt trước khi chưa trả cọc, giống đơn hàng sẵn chưa thanh toán.

### Nhân viên bán hàng: đợt đặt trước

18. Là nhân viên bán hàng, tôi muốn mở một đợt đặt trước cho một sản phẩm đã xuất bản, chọn biến thể và số suất từng biến thể, mức cọc, thời gian giao dự kiến, hạn đóng nhận đặt và số ngày được trả phần còn lại.
19. Là nhân viên bán hàng, tôi muốn hệ thống chặn mở đợt thứ hai khi sản phẩm đã có một đợt đang mở, để khách không thấy hai lời hẹn giao.
20. Là nhân viên bán hàng, tôi muốn sửa thời gian giao dự kiến và tăng hay giảm số suất (không thấp hơn số đã đặt), để phản ánh tình hình cung ứng.
21. Là nhân viên bán hàng, tôi muốn mức cọc và số ngày trả phần còn lại bị khóa khi đợt đã có đơn, để không đổi điều kiện khách đã đồng ý.
22. Là nhân viên bán hàng, tôi muốn cập nhật trạng thái nhập hàng của đợt (chưa đặt nhập, đã đặt nhập, đang về, gặp sự cố) kèm ghi chú nội bộ.
23. Là nhân viên bán hàng, tôi muốn đóng đợt bằng tay, và đợt tự ngừng nhận đặt khi tới hạn đóng, để không nhận vượt khả năng nhập.
24. Là nhân viên bán hàng, tôi muốn xem từng đợt với số suất, số đã cọc, số chờ cọc, số đã về của từng biến thể, cùng danh sách đơn theo thứ tự cọc.
25. Là nhân viên bán hàng, tôi muốn danh sách "Đặt trước cần xử lý" gồm các đơn quá hạn trả phần còn lại và các đợt gặp sự cố, để liên hệ khách kịp thời.

### Nhân viên kho

26. Là nhân viên kho, khi ghi phiếu nhập, tôi muốn thấy trước bao nhiêu hàng sẽ được giữ cho đơn đặt trước và bao nhiêu thành hàng sẵn, để soạn đúng và không bán nhầm hàng của người đã cọc.
27. Là nhân viên kho, tôi muốn đơn đặt trước đã trả đủ hiện trong danh sách cần soạn giống đơn hàng sẵn, và đơn chưa trả đủ thì không soạn được.

### Bán hàng, kế toán, chủ doanh nghiệp

28. Là nhân viên, tôi muốn lọc danh sách đơn theo loại (hàng sẵn, đặt trước) và theo đợt, và xem ở chi tiết đơn tiền cọc, phần còn lại, số đã được giữ hàng, hạn trả và từng giao dịch theo mục đích.
29. Là kế toán, tôi muốn tiền cọc về lệch, cọc về sau khi đơn đã hủy, hay phần còn lại bị trả hai lần đều vào danh sách cần đối soát như M3.

## Implementation Decisions

### Đợt đặt trước

- Bảng đợt: sản phẩm, tỷ lệ cọc (số nguyên 10–100), thời gian giao dự kiến (từ ngày, đến ngày), hạn đóng nhận đặt (thời điểm), số ngày được trả phần còn lại (số nguyên ≥ 1, mặc định 7), trạng thái nhập hàng (`not_ordered`, `ordered`, `in_transit`, `issue`) kèm ghi chú nội bộ, thời điểm đóng tay (`closed_at`, có thể trống), người tạo, thời điểm tạo.
- Bảng biến thể của đợt: đợt, biến thể, suất (số nguyên ≥ 1). Mỗi biến thể xuất hiện một lần trong một đợt.
- Đợt **đang mở** khi `closed_at` trống và hiện tại trước hạn đóng. Mỗi sản phẩm có tối đa một đợt đang mở: kiểm trong transaction tạo đợt, khóa dòng sản phẩm `FOR UPDATE`. Không có lịch mở trong tương lai, nên đợt mở ngay khi tạo.
- **Số đã dùng** của một biến thể trong đợt bằng tổng số lượng của các đơn đặt trước thuộc đợt, cho biến thể đó, chưa `cancelled`. Số này tính khi cần, không lưu thành bộ đếm.
- Một biến thể **đang nhận đặt trước** khi: sản phẩm đã xuất bản và biến thể có trong phiên bản đang xuất bản, biến thể không ngừng bán, `on_hand - reserved = 0`, biến thể thuộc đợt đang mở của sản phẩm, và số đã dùng < suất.
- Sửa đợt: thời gian giao dự kiến, hạn đóng, suất (không thấp hơn số đã dùng, 409 nếu thấp hơn), thêm biến thể, trạng thái nhập hàng và ghi chú. Khi đợt đã có đơn, tỷ lệ cọc và số ngày trả phần còn lại không sửa được (409), và không bỏ được biến thể đã có đơn. Đóng tay ghi `closed_at`, và không mở lại được.
- Đổi thời gian giao dự kiến thì gửi email cho mọi đơn của đợt đang `deposit_paid` và chưa thành hàng đã về. Các thay đổi khác không gửi email.

### Mô hình đơn

- Đơn thêm **loại** (`standard`, `preorder`). Đơn `preorder` có đúng một dòng đơn và tham chiếu tới đợt. Đơn chụp lại các giá trị sau, không đổi về sau: tỷ lệ cọc, tiền cọc, thời gian giao dự kiến lúc đặt, số ngày trả phần còn lại, và phiên bản **chính sách đặt trước** (thêm vào các phiên bản chính sách của đơn như M3).
- Tiền cọc = làm tròn lên tới 1.000 VND của (tiền hàng × tỷ lệ / 100). Phần còn lại = tổng phải trả − tiền cọc, gồm cả phí giao. Check constraint `0 < deposit_amount <= subtotal`.
- Đơn `preorder` thêm thời điểm cọc thành công (`deposit_paid_at`, dùng làm thứ tự chia hàng), thời điểm hàng đã về (`arrived_at`), hạn trả phần còn lại (`remainder_due_at` = `arrived_at` + số ngày), và thời điểm bị gắn cờ quá hạn (`remainder_overdue_at`).
- Dòng đơn thêm **số đã giữ hàng** (`reserved_quantity`, mặc định 0, check `0 <= reserved_quantity <= quantity`). Với đơn `standard`, số này bằng số lượng ngay khi giữ hàng ở M3. Với đơn `preorder`, số này tăng dần theo phiếu nhập.
- Trạng thái thanh toán thêm `deposit_paid`. Các cạnh của đơn `preorder`:
  - đơn hàng: `pending_payment` → `processing` (khi cọc thành công) → `completed`, hoặc `pending_payment` → `cancelled`;
  - thanh toán: `unpaid` → `deposit_paid` → `paid`;
  - giao hàng: như M3, và chỉ bắt đầu khi thanh toán `paid`.
  Đơn `standard` không đi qua `deposit_paid`. Sai cạnh thì 409.
- Không có thao tác hủy đơn ở `deposit_paid` (khách hay nhân viên đều không). M6 sẽ thêm thao tác này.

### Đặt trước (ADR 0012)

- `POST /api/preorders/quote`: nhận biến thể, số lượng, tỉnh/thành. Trả giá, đợt, tỷ lệ cọc, tiền cọc, phí giao, tổng, phần còn lại, thời gian giao dự kiến, số ngày trả phần còn lại, link chính sách đặt trước, và việc biến thể có đang nhận đặt trước hay không. Không ghi gì.
- `POST /api/preorders`: nhận biến thể, số lượng (1–5), id đợt, giá và tỷ lệ cọc khách đã thấy, thông tin nhận hàng, thông tin xuất hóa đơn tùy chọn, ghi chú, đồng ý chính sách bảo mật (bắt buộc với khách vãng lai) và đồng ý chính sách đặt trước (bắt buộc với mọi khách). Trong một transaction:
  1. khóa biến thể và dòng biến thể của đợt `FOR UPDATE`;
  2. kiểm tra: biến thể đang nhận đặt trước theo đúng đợt khách đã thấy, giá và tỷ lệ cọc không đổi, số đã dùng + số lượng ≤ suất. Nếu biến thể đã có hàng sẵn thì 409 với `details` `in_stock`. Các trường hợp khác (giá mới, mức cọc mới, hết suất, đợt đã đóng, ngừng bán) cũng 409 kèm `details`, và không ghi gì;
  3. tính phí giao, tạo đơn `preorder` có thời hạn giữ 15 phút (`reserved_until`, dùng chung job hết hạn của M3), nhưng **không giữ hàng**: đơn chỉ chiếm suất;
  4. tạo link thanh toán với số tiền bằng tiền cọc.
  Trả về như `POST /api/checkout`.
- Chưa cấu hình phí giao mặc định thì `quote` và `preorders` trả 503. Chưa có phiên bản chính sách đặt trước được xuất bản (slug cố định, như chính sách bảo mật) thì `preorders` trả 503, còn `quote` vẫn trả báo giá với `preorderPolicy: null` để trang hiện sản phẩm và lý do chưa nhận đặt (sửa sau review 2026-11-16, theo quyết định ở ticket 04).
- Giới hạn tần suất và số đơn đang `pending_payment` theo email/số điện thoại dùng chung bộ đếm với `POST /api/checkout`.
- Hết hạn và hủy đơn chưa cọc: như M3. Đơn đặt trước không có hàng đang giữ nên không có gì để nhả; suất tự trống ra vì đơn đã `cancelled`.

### Thanh toán

- Mã đơn bên cổng chuyển từ cột `order.gateway_reference` sang một bảng **link thanh toán**: đơn, mục đích, số tiền, mã đơn bên cổng (duy nhất), thời điểm tạo, hạn. Migration chuyển dữ liệu cũ sang với mục đích `full`. Truy vấn cổng (`refresh=1`, job hết hạn) duyệt các link của đơn.
- Giao dịch thanh toán thêm **mục đích** (`full`, `deposit`, `remainder`), lấy theo link mà giao dịch thuộc về.
- Hàm ghi nhận thanh toán (M3) thêm các nhánh sau, vẫn khóa đơn và chạy nhiều lần cho một kết quả:
  - đơn `preorder` đang `pending_payment`, giao dịch `deposit` đúng bằng tiền cọc → `deposit_paid` + `processing`, ghi `deposit_paid_at`, bỏ `reserved_until`, gửi email đã nhận cọc;
  - đơn `preorder` đang `deposit_paid` và đã về hàng, giao dịch `remainder` đúng bằng phần còn lại → `paid`, xóa cờ quá hạn nếu có, gửi email đã nhận thanh toán;
  - các trường hợp khác (lệch tiền, cọc về khi đơn đã hủy, trả phần còn lại khi đã `paid` hoặc khi hàng chưa về) → cần đối soát với các lý do sẵn có của M3. Không tự đổi trạng thái đơn.
- Khôi phục đơn từ đối soát (M3) với đơn `preorder` đã hủy: chỉ làm được khi tiền nhận đúng bằng tiền cọc và đợt còn đủ suất cho biến thể (không cần đợt đang mở). Đơn chuyển thành `deposit_paid` với `deposit_paid_at` là thời điểm khôi phục. Nếu không đủ suất thì 409.
- Trả phần còn lại: `POST /api/orders/:code/pay-remainder?token=…` và `POST /api/account/orders/:code/pay-remainder`. Chỉ dùng được khi đơn `deposit_paid` và đã về hàng, ngoài ra 409. Mỗi lần gọi tạo một link mới với số tiền bằng phần còn lại và hạn 15 phút. Link hết hạn không làm gì đơn.

### Hàng về (ADR 0013)

- Ghi phiếu nhập: trong cùng transaction, sau khi cộng `on_hand` cho từng dòng, hệ thống lấy các dòng đơn `preorder` của biến thể đó thuộc đơn `deposit_paid` và có `reserved_quantity < quantity`, sắp theo `deposit_paid_at` rồi mã đơn. Mỗi dòng được cộng `reserved_quantity` thêm min(phần thiếu, số còn lại của phiếu), đồng thời cộng `reserved` của biến thể cùng số đó. Việc này chạy qua module kho, cùng đường khóa với `changeStock`.
- Dòng đơn nào vừa được giữ đủ thì đơn có `arrived_at` = bây giờ, có `remainder_due_at`, và nhận email "Hàng đã về" kèm link trang đơn để trả phần còn lại.
- Phần dư của phiếu thành hàng sẵn. Điều chỉnh tồn và tồn đầu kỳ không chia hàng.
- Điều chỉnh tồn xuống dưới `reserved` thì vẫn 409 như M3, và danh sách mã đơn đang giữ có cả đơn đặt trước.
- `POST /api/admin/stock/receipts/preview` (hoặc thêm vào response kiểm tra của form phiếu nhập, tùy ticket): với các dòng định nhập, trả số sẽ giữ cho đơn đặt trước, số đơn liên quan và số thành hàng sẵn. Không ghi gì.
- Bàn giao vận chuyển của đơn `preorder` giống M3: trừ `on_hand` và `reserved`, ghi sổ `sale`.

### Hạn trả phần còn lại

- Job định kỳ mỗi giờ:
  - gửi email nhắc cho đơn `deposit_paid` đã về hàng, chưa nhắc, và còn ≤ 2 ngày tới `remainder_due_at` (đánh dấu đã nhắc trên đơn để không gửi lại);
  - gắn `remainder_overdue_at` cho đơn quá `remainder_due_at` mà vẫn `deposit_paid`, và ghi sự kiện đơn (actor: hệ thống).
  Chạy nhiều lần vẫn cho một kết quả.
- Đơn quá hạn vẫn giữ hàng và vẫn trả được phần còn lại. Không tự hủy, không mất cọc (M6).

### Hiển thị cho khách

- API sản phẩm trả tình trạng của từng biến thể: `in_stock`, `preorder` (kèm tỷ lệ cọc và thời gian giao dự kiến của đợt), hoặc `out_of_stock`. Vẫn không trả số lượng hay số suất (ADR 0006, cache `swr: 60`).
- Thẻ sản phẩm và kết quả tìm kiếm có cờ "đặt trước" khi sản phẩm không còn biến thể nào còn hàng sẵn nhưng có ít nhất một biến thể đang nhận đặt trước. Bộ lọc "còn hàng" và sắp xếp "còn hàng trước" vẫn chỉ tính hàng sẵn.
- JSON-LD `availability`: `InStock`, `PreOrder` hoặc `OutOfStock` theo cùng thứ tự ưu tiên.

### Quyền

- Quyền mới `preorder.manage` (owner, sales): tạo, sửa, đóng đợt; cập nhật trạng thái nhập hàng và thời gian giao dự kiến.
- Xem đợt, đơn đặt trước và danh sách "Đặt trước cần xử lý": `order.view`.
- Ghi phiếu nhập (kể cả phần chia hàng tự động): `stock.adjust`, như hiện có.
- Mọi thao tác ghi ở admin đi qua `audited()`. Chia hàng khi nhập, hàng đã về và gắn cờ quá hạn ghi vào sự kiện đơn.

### API quản trị

- Đợt: danh sách (lọc đang mở/đã đóng, theo sản phẩm, phân trang `PageQuery`), chi tiết (từng biến thể: suất, đã cọc, chờ cọc, đã về; danh sách đơn theo thứ tự cọc), tạo, sửa, đóng.
- Danh sách đơn thêm bộ lọc loại đơn, đợt, và "quá hạn trả phần còn lại".
- "Đặt trước cần xử lý": đơn quá hạn trả phần còn lại cùng đợt đang `issue` có đơn đã cọc.

### Email

Qua hàng đợi `send-email`, xếp trong cùng transaction với thay đổi:

1. đã nhận cọc: tiền cọc, phần còn lại, thời gian giao dự kiến, link tra cứu;
2. thời gian giao dự kiến thay đổi: thời gian cũ và mới;
3. hàng đã về: phần còn lại, hạn trả, link trang đơn;
4. nhắc trả phần còn lại;
5. đã nhận thanh toán (phần còn lại): dùng lại email M3.

Các email bàn giao và giao thất bại dùng lại M3.

### Web

- Khách: trên trang sản phẩm, biến thể đang nhận đặt trước hiện nút "Đặt trước" kèm mức cọc và thời gian giao dự kiến, thay cho "Thêm vào giỏ". Có trang đặt trước (`noindex`) gồm số lượng, thông tin nhận hàng, bảng tiền (tiền hàng, phí giao, tổng, cọc, còn lại), thời gian giao dự kiến, hạn trả phần còn lại và ô đồng ý chính sách đặt trước. Trang kết quả thanh toán dùng lại M3. Trang đơn hàng (token và tài khoản) có khối đặt trước với nút "Trả phần còn lại" khi được trả. Thẻ sản phẩm có nhãn "Đặt trước".
- Admin: mục Đặt trước (danh sách đợt, form tạo/sửa, chi tiết đợt, "Đặt trước cần xử lý"). Form phiếu nhập có bước xem trước phần giữ cho đơn đặt trước. Chi tiết đơn có khối đặt trước và giao dịch theo mục đích. Dashboard thêm số mục cần xử lý theo quyền. Menu khai quyền qua `ADMIN_MENU_ITEMS`.
- `scripts/smoke.ts` thêm trang đặt trước (`noindex`).

## Testing Decisions

- Test kiểm hành vi bên ngoài qua HTTP như M3. Các seam vẫn vậy: HTTP trên Postgres thật, cổng thanh toán giả trong bộ nhớ, gọi thẳng các hàm job với `now` ở tương lai, và E2E Playwright với cổng giả lập. Prior art: `checkout.test.ts`, `payments.test.ts`, `stock-receipts.test.ts`, `availability.test.ts`, các test hết hạn đơn của M3.
- E2E: nhân viên mở đợt → khách đặt trước biến thể hết hàng → giả lập trả cọc → kho ghi phiếu nhập → khách trả phần còn lại → kho soạn, bàn giao, đã giao. Kiểm tồn, đang giữ, sổ xuất nhập và ba trạng thái ở từng bước.
- Các hành vi bắt buộc có test:
  - **Đợt:** tạo, sửa, đóng; mở đợt thứ hai cho cùng sản phẩm thì 409; giảm suất dưới số đã dùng thì 409; sửa tỷ lệ cọc khi đã có đơn thì 409; thiếu `preorder.manage` thì 403; đổi thời gian giao dự kiến chỉ gửi email cho đơn đã cọc chưa về hàng.
  - **Hiển thị:** biến thể còn hàng sẵn không bao giờ là `preorder`; hết suất, đợt đóng, quá hạn đóng, ngừng bán đều cho `out_of_stock`; cờ sản phẩm và JSON-LD đúng; bộ lọc còn hàng không tính đặt trước.
  - **Đặt trước:** tạo đơn và link với số tiền bằng tiền cọc (làm tròn lên 1.000); không đụng `reserved`; giá, mức cọc, đợt đổi, hết suất, có hàng sẵn đều 409 kèm `details` và không ghi gì; thiếu đồng ý chính sách đặt trước bị từ chối; chưa có chính sách đặt trước thì 503; nhiều khách tranh suất cuối song song thì đúng một đơn được tạo.
  - **Cọc:** IPN đúng tiền → `deposit_paid` + `processing`, email gửi một lần; lệch tiền → cần đối soát; hết hạn chưa cọc → hủy và trống suất; cọc về sau khi hủy → đối soát; khôi phục khi còn suất thì được, hết suất thì 409.
  - **Hàng về:** phiếu nhập chia hàng theo thứ tự cọc, từng cái, giữ một phần được; đơn chờ cọc không được chia; phần dư thành hàng sẵn; đơn đủ hàng nhận email "Hàng đã về" và có hạn trả; điều chỉnh tồn không chia hàng; preview khớp với kết quả ghi thật; điều chỉnh xuống dưới số đang giữ thì 409 có cả mã đơn đặt trước.
  - **Phần còn lại:** trả trước khi hàng về thì 409; link đúng số tiền; trả thành công → `paid`; trả hai lần → đối soát `extra_payment`; link hết hạn không đổi đơn; chưa `paid` thì không soạn hàng được.
  - **Hạn trả:** nhắc đúng một lần trong cửa sổ 2 ngày; quá hạn gắn cờ, không hủy, vẫn trả được; job chạy lại không đổi gì.
  - **Không hủy đơn đã cọc:** khách (token, tài khoản) và nhân viên đều nhận 409.
  - **Migration link thanh toán:** đơn M3 cũ vẫn `refresh=1` và hết hạn đúng.

## Out of Scope

- Hủy đơn đã cọc, hoàn tiền, mất cọc khi quá hạn hoặc khi khách đổi ý, xử lý tiền khi không nhập được hàng (M6). Ở M4, các trường hợp này xử lý ngoài hệ thống.
- Giỏ hàng có cả hàng sẵn và hàng đặt trước, hoặc đặt trước nhiều biến thể trong một đơn (ADR 0012).
- Voucher, kể cả ưu đãi cho đơn đặt trước (M5).
- Giá riêng theo đợt: đơn đặt trước dùng giá bán của biến thể lúc đặt.
- Mức cọc là số tiền cố định, hoặc khác nhau giữa các biến thể trong một đợt.
- Lịch mở đợt trong tương lai; mở lại đợt đã đóng.
- Theo dõi đơn đặt nhập với nhà cung cấp (số đơn nhà cung cấp, chứng từ). Ở M4 chỉ có trạng thái nhập hàng của đợt.
- Sửa địa chỉ, đổi size hay màu của đơn đã đặt; giao từng phần một đơn đặt trước.
- Email báo khi đợt gặp sự cố, và "báo tôi khi có hàng" cho biến thể hết hàng không có đợt.
- Báo cáo tiền cọc và số còn phải thu (M7).

## Further Notes

- GLOSSARY có mục **Đặt trước** mới: đợt đặt trước, đơn đặt trước, đang nhận đặt trước, suất, tiền cọc, phần còn lại, hàng đã về.
- Buổi làm rõ 2026-11-14 chốt: đơn vị mở bán là đợt; đặt trước chỉ hiện khi biến thể hết hàng sẵn; đặt trước ngoài giỏ; giá lấy từ giá bán; cọc theo % của đợt, tính trên tiền hàng, làm tròn lên 1.000, phí giao nằm trong phần còn lại; mỗi đơn có suất; mọi phiếu nhập tự chia hàng từng cái theo thứ tự cọc; thanh toán `unpaid` → `deposit_paid` → `paid`; địa chỉ và phí giao chốt lúc đặt; trạng thái nhập hàng theo dõi ở cấp đợt; mỗi sản phẩm tối đa một đợt mở; M4 không hủy đơn đã cọc; quá hạn chỉ gắn cờ; chính sách đặt trước là trang chính sách có phiên bản; khách vãng lai được đặt trước; quyền `preorder.manage` cho owner và sales.
- Các con số, đã chốt giữ nguyên (2026-11-23): tỷ lệ cọc tối thiểu 10%, mặc định 7 ngày trả phần còn lại, nhắc trước 2 ngày, 1–5 cái mỗi đơn.
- Trước khi mở bán thật, doanh nghiệp cần xuất bản trang chính sách đặt trước, gồm điều kiện hủy/hoàn và xử lý khi quá hạn hay khi không nhập được hàng, dù M4 chưa tự động hóa các phần đó.
