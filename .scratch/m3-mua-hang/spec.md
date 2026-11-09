# Spec: M3 — Mua hàng có sẵn

**Status:** ready-for-agent

Nguồn: `project-overview.md` (mục 4, 5.1, 5.4, 5.5, 6.1, 10.1), Out of Scope của spec M2 (`.scratch/m2-ton-kho/spec.md`) và phiên làm rõ requirement ngày 2026-10-30 (35 câu, người dùng chấp nhận mọi đề xuất). Đây là mốc thứ ba trong lộ trình M0 → M8 của giai đoạn 1 (mở bán). Quyết định kiến trúc: `docs/adr/0007-giu-hang-khong-tru-ton-hang-roi-ton-khi-ban-giao.md`, `docs/adr/0008-payos-chuyen-khoan-vietqr.md`.

## Problem Statement

Sau M2, khách xem được sản phẩm, giá và biết biến thể nào còn hàng, nhưng không mua được gì trên website. Doanh nghiệp vẫn phải nhận đơn qua tin nhắn, đối chiếu chuyển khoản bằng mắt với sao kê, tự trừ hàng trong đầu và ghi mã vận đơn ở chỗ khác. Hai khách có thể cùng chốt biến thể cuối cùng, tiền về mà không biết thuộc đơn nào, và không có nơi nào cho biết đơn đã trả tiền nhưng chưa giao.

## Solution

Khách thêm biến thể vào giỏ hàng, đặt mua với thông tin nhận hàng, thấy phí giao và tổng tiền, rồi chuyển khoản qua mã VietQR của PayOS. Lúc đặt mua, hệ thống kiểm lại giá và tồn, tạo đơn hàng và giữ hàng trong 15 phút; tiền về đúng thì đơn thành đã trả đủ, quá hạn thì đơn tự hủy và nhả hàng. Khách vãng lai mua được không cần đăng nhập và tra cứu đơn qua link trong email; khách có tài khoản thấy lịch sử mua.

Ở trang quản trị, nhân viên kho thấy đơn cần soạn, in phiếu soạn hàng, ghi bàn giao vận chuyển kèm mã vận đơn (lúc này hàng mới rời tồn, ghi sổ xuất bán), rồi đánh dấu đã giao hoặc giao thất bại. Tiền về không khớp với đơn được đưa vào danh sách cần đối soát để kế toán hoặc chủ doanh nghiệp quyết định, không bao giờ tự xử lý.

Mốc này **chỉ có hàng có sẵn và chỉ chuyển khoản qua PayOS**: chưa có đặt trước (M4), voucher (M5), hủy đơn đã thanh toán hay hoàn tiền (M6).

## User Stories

### Khách hàng: giỏ hàng

1. Là khách hàng, tôi muốn thêm một biến thể còn hàng vào giỏ hàng từ trang sản phẩm, để mua nhiều món trong một lần.
2. Là khách hàng, tôi muốn đổi số lượng hoặc bỏ một dòng trong giỏ, để chỉnh trước khi đặt mua.
3. Là khách hàng, tôi muốn giỏ hàng còn nguyên khi tải lại trang hoặc quay lại sau, để không phải chọn lại.
4. Là khách hàng, tôi muốn thấy số món trong giỏ ở header trên mọi trang, để biết mình đã chọn gì.
5. Là khách hàng, tôi muốn không chọn được quá 5 cái của cùng một biến thể, để biết giới hạn ngay thay vì bị từ chối lúc đặt mua.
6. Là khách hàng, tôi muốn không thêm được biến thể hết hàng hoặc ngừng bán vào giỏ, để không mất công.

### Khách hàng: đặt mua

7. Là khách hàng, tôi muốn đặt mua mà không cần tạo tài khoản, chỉ nhập email và số điện thoại, để mua nhanh lần đầu.
8. Là khách đã đăng nhập, tôi muốn form đặt mua tự điền địa chỉ tôi dùng lần trước, để khỏi gõ lại.
9. Là khách hàng, tôi muốn chọn tỉnh/thành và phường/xã theo danh mục hành chính mới rồi gõ số nhà, đường, để địa chỉ đúng và tính được phí giao.
10. Là khách hàng, tôi muốn thấy phí giao theo tỉnh/thành ngay khi chọn, và biết đơn của tôi có được miễn phí giao hay không, để biết tổng tiền trước khi xác nhận.
11. Là khách hàng, tôi muốn thấy rõ từng dòng đơn, giá bán, phí giao và tổng phải trả trước khi xác nhận, để không bất ngờ.
12. Là khách hàng, khi giá đã đổi, biến thể đã ngừng bán hoặc không còn đủ hàng kể từ lúc tôi thêm vào giỏ, tôi muốn thấy thay đổi của từng dòng và phải xác nhận lại, để hệ thống không tự đặt theo giá mới.
13. Là khách hàng có món chỉ giao đường bộ trong giỏ, tôi muốn thấy lưu ý thời gian giao lâu hơn, để không bất ngờ.
14. Là khách vãng lai, tôi muốn tick đồng ý chính sách bảo mật trước khi gửi thông tin nhận hàng, để biết dữ liệu của tôi được dùng thế nào.
15. Là khách hàng, tôi muốn thấy link chính sách đổi trả và bảo hành áp dụng cho các món trong đơn, để biết điều kiện trước khi mua.
16. Là khách hàng mua bằng tiền công ty, tôi muốn nhập tên công ty, mã số thuế và địa chỉ xuất hóa đơn khi đặt mua, để kế toán xuất hóa đơn mà không phải hỏi lại.
17. Là khách hàng, tôi muốn ghi chú cho đơn, để dặn thời gian nhận hoặc cách liên hệ.
18. Là khách hàng, khi cửa hàng chưa cấu hình phí giao, tôi muốn thấy thông báo cửa hàng chưa sẵn sàng nhận đơn, thay vì đặt được một đơn sai tiền.

### Khách hàng: thanh toán

19. Là khách hàng, sau khi đặt mua tôi muốn được đưa tới trang thanh toán của PayOS với mã VietQR đúng số tiền, để chuyển khoản bằng app ngân hàng.
20. Là khách hàng, tôi muốn biết hàng của tôi được giữ trong 15 phút và còn bao lâu, để thanh toán kịp.
21. Là khách hàng, khi quay về website sau khi chuyển khoản, tôi muốn thấy ngay đơn đã được ghi nhận thanh toán hay chưa, kể cả khi thông báo của cổng thanh toán tới chậm.
22. Là khách hàng, tôi muốn nhận email xác nhận đã nhận thanh toán, kèm tóm tắt đơn và link tra cứu.
23. Là khách hàng, nếu tôi chưa trả tiền mà muốn thôi, tôi muốn tự hủy đơn, để hàng được nhả cho người khác.
24. Là khách hàng, khi tôi để quá 15 phút, tôi muốn thấy đơn đã hết hạn và có thể đặt mua lại từ giỏ hàng.
25. Là khách hàng, khi tôi chuyển sai số tiền hoặc chuyển sau khi đơn đã hết hạn, tôi muốn shop nhìn thấy khoản tiền đó và liên hệ tôi, thay vì tiền bị mất dấu.

### Khách hàng: theo dõi đơn

26. Là khách hàng, tôi muốn xem đơn qua link trong email mà không cần đăng nhập, để theo dõi từ điện thoại.
27. Là khách đã đăng nhập, tôi muốn thấy lịch sử mua với trạng thái từng đơn.
28. Là khách từng mua kiểu vãng lai, sau khi đăng ký và xác minh cùng email, tôi muốn thấy các đơn cũ trong lịch sử mua.
29. Là khách hàng, tôi muốn thấy riêng trạng thái thanh toán và trạng thái giao hàng, để biết "đã trả tiền" khác "đã giao".
30. Là khách hàng, tôi muốn nhận email khi đơn đã bàn giao vận chuyển, kèm tên đơn vị vận chuyển và mã vận đơn, để tự theo dõi kiện hàng.
31. Là khách hàng, tôi muốn nhận email khi giao thất bại, biết shop sẽ liên hệ.
32. Là người nhận được link tra cứu của người khác, tôi chỉ được xem, không được sửa hay hủy gì ngoài việc hủy đơn chưa thanh toán.

### Nhân viên kho: xử lý đơn

33. Là nhân viên kho, tôi muốn danh sách đơn đã trả đủ đang chờ soạn, mới nhất cuối cùng, để soạn theo thứ tự.
34. Là nhân viên kho, tôi muốn đánh dấu đơn đang chuẩn bị, để người khác không soạn trùng.
35. Là nhân viên kho, tôi muốn in phiếu soạn hàng có SKU, tên sản phẩm, thuộc tính, số lượng và địa chỉ nhận, để lấy đúng hàng.
36. Là nhân viên kho, tôi muốn ghi bàn giao vận chuyển với tên đơn vị vận chuyển và mã vận đơn, để khách tra được kiện hàng.
37. Là nhân viên kho, tôi muốn tồn tự giảm và sổ xuất nhập ghi dòng xuất bán khi tôi bàn giao, để tồn khớp với hàng trên kệ.
38. Là nhân viên kho, tôi muốn đánh dấu đã giao hoặc giao thất bại sau khi xem trạng thái trên trang của đơn vị vận chuyển.
39. Là nhân viên kho, khi kiểm kê ra số thấp hơn số đang giữ cho đơn, tôi muốn bị chặn kèm danh sách đơn đang giữ, để xử lý các đơn đó trước.
40. Là nhân viên kho, tôi muốn thấy cột "đang giữ" cạnh tồn ở trang Tồn kho, để biết bao nhiêu hàng trên kệ đã thuộc về đơn.
41. Là nhân viên, tôi muốn hủy một đơn chưa thanh toán (ví dụ khách gọi điện báo thôi), để nhả hàng ngay.

### Bán hàng, kế toán, chủ doanh nghiệp

42. Là nhân viên bán hàng, tôi muốn tìm đơn theo mã đơn, số điện thoại hoặc email, để trả lời khách gọi tới.
43. Là nhân viên, tôi muốn lọc đơn theo trạng thái đơn hàng, thanh toán và giao hàng.
44. Là nhân viên, tôi muốn xem chi tiết đơn với lịch sử thao tác: ai làm gì, lúc nào.
45. Là kế toán, tôi muốn danh sách đơn cần đối soát với số tiền nhận, số tiền đơn và lý do (lệch tiền, tiền về sau khi hết hạn hoặc đã hủy).
46. Là kế toán, khi tiền về khớp đúng tổng đơn và vẫn còn đủ hàng, tôi muốn khôi phục đơn để nó đi tiếp như đơn đã thanh toán.
47. Là kế toán, khi đã hoàn tiền tay hoặc xử lý ngoài hệ thống, tôi muốn đóng mục cần đối soát với ghi chú bắt buộc (số tiền, mã giao dịch ngân hàng).
48. Là kế toán, tôi muốn thấy thông tin xuất hóa đơn công ty của đơn, để xuất hóa đơn điện tử ở phần mềm riêng.
49. Là chủ doanh nghiệp, tôi muốn cấu hình phí giao theo tỉnh/thành, một mức mặc định và ngưỡng miễn phí giao.
50. Là chủ doanh nghiệp, tôi muốn mọi thao tác trên đơn, đối soát và phí giao đều có trong audit log.
51. Là chủ doanh nghiệp, tôi muốn chỉ người được cấp quyền mới xem đơn, xử lý giao hàng hay đối soát tiền.

### Vận hành và phát triển

52. Là lập trình viên chạy local chưa có tài khoản PayOS, tôi muốn đi trọn luồng mua hàng bằng cổng giả lập có nút "giả lập đã thanh toán" và "giả lập hết hạn".
53. Là người vận hành, tôi muốn API từ chối khởi động ở production nếu thiếu khóa PayOS, để không bao giờ lỡ chạy cổng giả lập ngoài thật.

## Implementation Decisions

### Mô hình đơn hàng

- Bảng đơn hàng có **mã đơn** là số nguyên tăng dần (sequence riêng, bắt đầu từ 100000), dùng chung làm `orderCode` gửi PayOS và mã khách thấy (`#100123`); id nội bộ vẫn là uuid.
- Ba trạng thái độc lập (GLOSSARY "Trạng thái đơn hàng / thanh toán / giao hàng"):
  - đơn hàng: `pending_payment` → `processing` → `completed`, hoặc `cancelled`;
  - thanh toán: `unpaid` → `paid`;
  - giao hàng: `not_prepared` → `preparing` → `handed_over` → `delivered` hoặc `failed`.
  M4 sẽ thêm `deposit_paid` vào thanh toán; M6 thêm các trạng thái hoàn tiền. Đơn ở `failed` giữ `processing` chờ M6.
- Chuyển trạng thái chỉ theo các cạnh trên; sai cạnh trả 409. Giao hàng chỉ bắt đầu khi thanh toán đã `paid`.
- Snapshot lúc đặt mua, không đổi về sau: mỗi dòng đơn lưu variant id, SKU, tên sản phẩm, thuộc tính biến thể, ảnh đại diện, giá bán và số lượng; đơn lưu tên người nhận, số điện thoại, email, tỉnh/thành, phường/xã, số nhà/đường, ghi chú, phí giao, tổng tiền hàng, tổng phải trả, thông tin xuất hóa đơn công ty (tùy chọn: tên, mã số thuế, địa chỉ), và id các **phiên bản chính sách** đổi trả/bảo hành gắn với sản phẩm trong đơn tại thời điểm đó.
- Đơn gắn `customer_id` khi khách đã đăng nhập. Đơn vãng lai không có `customer_id`; khi một khách xác minh email, các đơn vãng lai cùng email (so sánh chữ thường) tự gắn vào tài khoản đó. Chỉ email đã xác minh mới gắn được.
- Mỗi đơn có một **token tra cứu** ngẫu nhiên, chỉ lưu hash (như token khách hiện có), không hết hạn, cho xem đơn và hủy đơn chưa thanh toán; không cho sửa gì khác.
- Địa chỉ dùng lần trước của khách đã đăng nhập lưu trên khách hàng (một bản, ghi đè mỗi lần đặt mua thành công); không có sổ địa chỉ.

### Giữ hàng và tồn (ADR 0007)

- Thêm `reserved INTEGER NOT NULL DEFAULT 0` vào biến thể, check `reserved >= 0` và `reserved <= on_hand`.
- Giữ hàng đi qua module kho, cùng đường khóa với `changeStock`: khóa biến thể `FOR UPDATE` theo thứ tự id, kiểm `on_hand - reserved >= số lượng` từng dòng, cộng `reserved`. Thiếu hàng ở bất kỳ dòng nào thì không giữ dòng nào.
- Nhả giữ hàng (hủy, hết hạn) trừ `reserved`, không ghi sổ xuất nhập.
- Bàn giao vận chuyển: trong một transaction, khóa các biến thể, trừ cả `on_hand` và `reserved`, ghi một dòng sổ loại mới `sale` (GLOSSARY "Xuất bán") cho mỗi dòng đơn, tham chiếu tới đơn (cột `order_id` trên sổ, check: loại `sale` bắt buộc có đơn).
- Điều chỉnh tồn (kiểm kê, hỏng, mất, khác) làm `on_hand` mới nhỏ hơn `reserved` thì 409, kèm danh sách mã đơn đang giữ biến thể đó; phiếu nhập không bị ảnh hưởng.
- "Còn hàng" ở mọi chỗ (API sản phẩm, thẻ sản phẩm, tìm kiếm, sắp xếp còn hàng trước, JSON-LD `availability`, trang Tồn kho) đổi sang `on_hand - reserved > 0`. Trang Tồn kho thêm cột đang giữ.
- **Thời hạn giữ hàng**: 15 phút từ lúc tạo đơn, cấu hình trong code. Đơn đã `paid` không còn hạn.
- Hết hạn: khi tạo đơn, xếp một job pg-boss `expire-order` chạy đúng lúc hết hạn; thêm job định kỳ mỗi phút quét đơn `pending_payment` quá hạn để không sót khi job bị mất. Hàm hết hạn chạy nhiều lần vẫn cho một kết quả: chỉ hủy đơn còn `pending_payment` và đã quá hạn, nhả giữ hàng, gọi cổng thanh toán hủy link (lỗi khi hủy link chỉ log, không chặn).

### Đặt mua

- Giỏ hàng chỉ ở localStorage của trình duyệt (danh sách variant id và số lượng, kèm giá lúc thêm để phát hiện đổi giá). Server không lưu giỏ.
- `POST /api/checkout/quote`: nhận giỏ và tỉnh/thành, trả từng dòng với giá hiện tại, còn hàng hay không, phí giao, tổng; không ghi gì. Trang đặt mua gọi khi mở và khi đổi tỉnh/thành.
- `POST /api/checkout`: nhận giỏ (kèm giá khách đã thấy cho từng dòng), thông tin nhận hàng, thông tin xuất hóa đơn tùy chọn, ghi chú, và đồng ý chính sách bảo mật (bắt buộc với khách vãng lai). Trong một transaction:
  1. kiểm từng dòng: biến thể thuộc sản phẩm đã xuất bản và có trong phiên bản đang xuất bản, không ngừng bán, giá hiện tại bằng giá khách đã thấy, số lượng 1–5;
  2. có dòng sai thì 409 kèm `details` mô tả thay đổi từng dòng (giá mới, hết hàng, ngừng bán), không ghi gì;
  3. tính phí giao, tạo đơn, giữ hàng (thiếu hàng cũng là 409 theo dòng), ghi đồng ý chính sách bảo mật của khách vãng lai kèm phiên bản;
  4. tạo link thanh toán qua cổng thanh toán với số tiền là tổng phải trả và thời hạn bằng thời hạn giữ hàng.
  Trả mã đơn, token tra cứu (chỉ trong response này), `checkoutUrl`, thời điểm hết hạn.
- Tạo link thanh toán gọi ra ngoài: nếu cổng lỗi thì rollback toàn bộ (không có đơn, không giữ hàng) và trả 502 "chưa tạo được thanh toán, thử lại".
- Giới hạn tần suất dùng cơ chế `enforceRateLimits` có sẵn: 5 lần đặt mua mỗi giờ cho mỗi IP; tối đa 3 đơn đang `pending_payment` cho mỗi email và cho mỗi số điện thoại (đếm trong DB, không phải bộ đếm cửa sổ). Con số tạm, chờ chủ doanh nghiệp xác nhận.
- Chưa cấu hình mức phí giao mặc định thì `quote` và `checkout` trả 503 "Cửa hàng chưa sẵn sàng nhận đơn" (giống đăng ký khi chưa có chính sách bảo mật).
- Đơn có ít nhất một sản phẩm `ground_shipping_only` thì response có cờ để trang hiện lưu ý giao đường bộ; không tính phí riêng.

### Phí giao

- Bảng cấu hình: một mức mặc định, các mức riêng theo tỉnh/thành, ngưỡng miễn phí giao (tổng tiền hàng từ ngưỡng trở lên thì phí giao bằng 0; để trống là không có miễn phí). Tất cả VND, số nguyên ≥ 0.
- Danh mục hành chính mới (34 tỉnh/thành, phường/xã, không còn cấp quận/huyện từ 01/07/2025) lưu tĩnh trong `@ecommerce/shared` dưới dạng mã và tên; API và web dùng chung để kiểm và hiện. Không gọi API bên ngoài.
- Sửa cấu hình phí giao cần `price.edit` (phí giao là một loại giá khách trả); ghi audit `shipping.fee.update` với before/after. Quyết định này ghi vào ticket.

### Thanh toán (ADR 0008)

- Interface cổng thanh toán, inject vào `createApp` như `Storage` và `EmailQueue`:
  - tạo link (mã đơn, số tiền, mô tả, `returnUrl`, `cancelUrl`, thời hạn) → `checkoutUrl`;
  - truy vấn theo mã đơn → trạng thái, số tiền đã nhận, các giao dịch;
  - hủy link theo mã đơn.
  Kiểm chữ ký webhook không nằm trong interface: là hàm thuần dùng checksum key (HMAC-SHA256 trên `data`, key xếp alphabet, `null` thành chuỗi rỗng), để test ký được payload thật.
- Ba bản: PayOS thật (qua API hoặc SDK chính thức), bản giả trong bộ nhớ cho test, và **cổng giả lập** cho local có trang thanh toán riêng với nút "Giả lập đã thanh toán" và "Giả lập hết hạn". Chọn bản theo biến môi trường: có đủ khóa PayOS thì dùng PayOS; thiếu khóa thì dùng cổng giả lập, trừ khi `NODE_ENV=production` thì API dừng khởi động với thông báo rõ.
- Hàm **ghi nhận thanh toán** duy nhất, chạy nhiều lần vẫn một kết quả, nhận (mã đơn, số tiền, mã tham chiếu giao dịch, nguồn):
  - khóa đơn `FOR UPDATE`;
  - giao dịch (mã tham chiếu) đã ghi thì bỏ qua;
  - ghi bảng giao dịch thanh toán (chỉ ghi thêm, trigger chặn sửa/xóa): đơn, số tiền, mã tham chiếu, thời điểm, nguồn (`webhook`/`query`/`simulator`), payload gốc;
  - đơn `pending_payment` và tổng đã nhận bằng đúng tổng phải trả → `paid` + `processing`, bỏ hạn giữ hàng, xếp email "đã nhận thanh toán";
  - mọi trường hợp khác (lệch tiền, đơn đã hủy hoặc hết hạn, tiền về thêm cho đơn đã `paid`) → gắn cờ **cần đối soát** kèm lý do; không tự đổi trạng thái đơn.
- Hai đường gọi vào hàm đó:
  - `POST /api/payments/payos/webhook`: không cần đăng nhập, kiểm chữ ký (sai thì 400, không ghi gì), luôn trả 2xx khi đã xử lý hoặc giao dịch đã ghi trước đó;
  - trang kết quả (`returnUrl`) gọi `GET /api/orders/:code?token=…` có tham số `refresh=1`: server truy vấn cổng theo mã đơn rồi ghi nhận các giao dịch mới, sau đó trả đơn.
- Đăng ký URL webhook với PayOS là thao tác của người vận hành (ticket `ready-for-human`), không làm lúc API khởi động.

### Đối soát

- Đơn cần đối soát có lý do (`amount_mismatch`, `paid_after_cancel`, `extra_payment`), số tiền nhận, thời điểm, và trạng thái đối soát (`open`/`resolved`).
- Cần quyền mới `payment.reconcile` (owner, accountant):
  - **Khôi phục đơn**: chỉ khi đơn đang `cancelled` vì hết hạn hoặc hủy, tổng đã nhận bằng đúng tổng phải trả, và giữ lại được đủ hàng; đơn thành `paid` + `processing` như thanh toán bình thường, gửi email đã nhận thanh toán. Không đủ hàng thì 409.
  - **Đã xử lý ngoài hệ thống**: ghi chú bắt buộc; đóng mục đối soát, không đổi trạng thái đơn.
  Cả hai ghi audit. Theo dõi hoàn tiền đầy đủ thuộc M6.

### Quyền

- `order.view`: owner, sales, warehouse, accountant — xem danh sách, chi tiết, phiếu soạn hàng, danh sách cần đối soát.
- `order.fulfill`: owner, warehouse — chuẩn bị, bàn giao, đã giao, giao thất bại, hủy đơn chưa thanh toán.
- `payment.reconcile`: owner, accountant.
- Phí giao: `price.edit` (đã có).
- Menu và lối tắt admin khai quyền qua `ADMIN_MENU_ITEMS` (CODING_STANDARDS "Web").

### API

- Công khai: `POST /api/checkout/quote`, `POST /api/checkout`, `GET /api/orders/:code?token=…` (kèm `refresh=1`), `POST /api/orders/:code/cancel?token=…`, `POST /api/payments/payos/webhook`, `GET /api/shipping/regions` (danh mục hành chính) — hoặc trả danh mục cùng `quote`, tùy ticket.
- Khách đã đăng nhập: `GET /api/account/orders`, `GET /api/account/orders/:code`, `POST /api/account/orders/:code/cancel`.
- Quản trị: danh sách đơn (lọc theo ba trạng thái, tìm theo mã đơn/số điện thoại/email, phân trang `PageQuery`), chi tiết đơn kèm lịch sử thao tác, chuyển trạng thái giao hàng (bàn giao kèm `carrier` và `trackingNumber` bắt buộc), hủy đơn chưa thanh toán, danh sách cần đối soát và hai thao tác đối soát, đọc và sửa cấu hình phí giao.
- Mọi thao tác ghi ở admin đi qua `audited()`; hủy, hết hạn và ghi nhận thanh toán của khách hoặc hệ thống cũng ghi vào lịch sử thao tác của đơn (actor là khách/hệ thống), bằng một bảng sự kiện đơn chỉ ghi thêm.
- Schema request/response trong `@ecommerce/shared`, lỗi bằng `AppError` và `fields`/`details` như hiện có.

### Email

Qua hàng đợi `send-email` hiện có, xếp trong cùng transaction với thay đổi trạng thái:

1. đã nhận thanh toán: tóm tắt đơn, tổng tiền, link tra cứu;
2. đã bàn giao vận chuyển: đơn vị vận chuyển, mã vận đơn, link tra cứu;
3. giao thất bại: shop sẽ liên hệ.

Không gửi email khi đơn mới tạo, khi hết hạn hay khi khách tự hủy.

### Web

- Khách: nút "Thêm vào giỏ" ở trang sản phẩm (theo biến thể đang chọn, khóa khi hết hàng hoặc ngừng bán), biểu tượng giỏ có số món ở header, trang giỏ hàng, trang đặt mua, trang kết quả thanh toán (`returnUrl`, tự `refresh=1`), trang đơn hàng qua token, mục "Đơn hàng của tôi" trong trang tài khoản. Trang giỏ, đặt mua, kết quả và đơn hàng là `noindex` và không SSR dữ liệu cá nhân.
- Cổng giả lập: một trang trên web (chỉ có khi API dùng cổng giả lập) hiện số tiền, mã đơn và hai nút giả lập.
- Admin: Đơn hàng (danh sách, chi tiết, phiếu soạn hàng in được bằng CSS print), Cần đối soát, Phí giao; cột "Đang giữ" ở trang Tồn kho; dashboard thêm số đơn chờ soạn và số mục cần đối soát theo quyền.
- `scripts/smoke.ts` thêm các trang khách mới (giỏ hàng, đặt mua có `noindex`).

## Testing Decisions

- Test kiểm hành vi bên ngoài, không kiểm cách cài: gọi HTTP, đọc kết quả qua HTTP. `prisma` chỉ để dựng trạng thái (CODING_STANDARDS "Test").
- **Seam 1 — HTTP** (supertest trên Postgres thật, Testcontainers), như M0–M2. Prior art: `stock.test.ts`, `stock-receipts.test.ts`, `customer-auth.test.ts`, `rate-limit.test.ts`, `availability.test.ts`.
- **Seam 2 — cổng thanh toán giả trong bộ nhớ**, inject qua `createTestApp` như `InMemoryStorage`/`InMemoryMailer`: ghi lại link đã tạo, link đã hủy, trả trạng thái truy vấn do test đặt, và có thể giả lập lỗi khi tạo link. Webhook được test **tự ký bằng checksum key của test** rồi POST qua HTTP, nên phần kiểm chữ ký là code thật.
- **Seam 3 — job hết hạn**: test gọi thẳng hàm hết hạn với `now` ở tương lai, rồi kiểm qua HTTP (giống `cleanup.test.ts`; ngoại lệ đã ghi trong CODING_STANDARDS).
- **Seam 4 — E2E Playwright** trên stack của `pnpm smoke --keep` với cổng giả lập: khách thêm vào giỏ → đặt mua → giả lập đã thanh toán → nhân viên kho chuẩn bị, bàn giao, đã giao; kiểm tồn, đang giữ, sổ xuất nhập và trạng thái ở từng bước. Thay cho mục "smoke admin" ghi ở ticket 15.
- Hành vi bắt buộc có test:
  - **Đặt mua:** tạo đơn, giữ hàng và trả link; giá đổi, ngừng bán, hết hàng, sản phẩm không còn xuất bản đều 409 theo dòng và không ghi gì; quá 5 cái mỗi biến thể bị từ chối; khách vãng lai thiếu đồng ý chính sách bảo mật bị từ chối; chưa có phí giao mặc định thì 503; cổng lỗi khi tạo link thì không có đơn và không giữ hàng; giới hạn tần suất theo IP và số đơn đang chờ theo email/số điện thoại.
  - **Phí giao:** mức riêng của tỉnh thắng mức mặc định; đạt ngưỡng thì miễn phí; đơn lưu phí lúc đặt, sửa cấu hình sau không đổi đơn.
  - **Snapshot:** đổi giá, tên hay chính sách sau khi đặt không đổi đơn; đơn lưu đúng phiên bản chính sách.
  - **Giữ hàng đồng thời:** nhiều khách đặt biến thể cuối cùng song song thì đúng một đơn được tạo, các đơn khác 409; `reserved` không vượt `on_hand`.
  - **Thanh toán:** webhook đúng chữ ký và đúng tiền → đã trả đủ, email gửi đúng một lần; webhook sai chữ ký 400 và không ghi gì; cùng webhook gửi hai lần chỉ ghi một giao dịch; `refresh=1` ghi nhận được khi chưa có webhook; webhook và truy vấn cùng về chỉ ghi một lần; lệch tiền → cần đối soát, đơn vẫn chưa thanh toán; tiền về sau khi hết hạn → cần đối soát, đơn vẫn hủy.
  - **Hết hạn và hủy:** hết hạn nhả giữ hàng, hủy link, chạy lại không đổi gì, không động tới đơn đã trả; khách hủy bằng token và bằng tài khoản; token sai không xem được đơn; không hủy được đơn đã trả.
  - **Xử lý đơn:** chuẩn bị → bàn giao trừ `on_hand` và `reserved`, ghi dòng sổ `sale` có tham chiếu đơn; bàn giao thiếu mã vận đơn bị từ chối; sai cạnh trạng thái 409; đã giao → đơn hoàn tất; giao thất bại giữ đơn đang xử lý; email bàn giao và giao thất bại.
  - **Kho:** "còn hàng" ở API sản phẩm và tìm kiếm tính theo `on_hand - reserved`; điều chỉnh xuống dưới số đang giữ 409 kèm mã đơn.
  - **Đối soát:** khôi phục đơn khi đủ điều kiện; khôi phục khi thiếu hàng 409; đóng mục cần ghi chú.
  - **Tài khoản:** đơn của khách đăng nhập hiện trong lịch sử; đơn vãng lai gắn vào tài khoản chỉ sau khi xác minh email; địa chỉ lần trước được trả về.
  - **Quyền và audit:** thiếu `order.view`, `order.fulfill`, `payment.reconcile`, `price.edit` thì 403 ở đúng chỗ; mỗi thao tác ghi audit; bảng giao dịch thanh toán và bảng sự kiện đơn không sửa xóa được (trigger, thử bằng SQL).
  - **Khởi động:** production thiếu khóa PayOS thì API không khởi động.

## Out of Scope

- Đặt trước, đặt cọc, giỏ có cả hàng sẵn và hàng đặt trước (M4).
- Voucher (M5).
- Hủy đơn đã thanh toán, hoàn tiền có theo dõi, đổi trả, bảo hành, nhập lại kho từ giao thất bại hoặc đổi trả, ticket hỗ trợ (M6).
- Báo cáo bán hàng, doanh thu, tiền đã nhận (M7).
- COD, chuyển khoản đối soát tay ngoài PayOS, thanh toán thẻ.
- Kết nối API đơn vị vận chuyển, tính phí theo cân nặng, phụ phí hàng chỉ giao đường bộ.
- Nhân viên tạo đơn hộ khách; sửa đơn sau khi đặt (đổi size, đổi địa chỉ); tách một đơn thành nhiều kiện hoặc giao từng phần (một đơn = một kiện = một mã vận đơn).
- Giỏ hàng lưu trên server hoặc đồng bộ giữa các máy; sổ địa chỉ nhiều mục.
- Tích hợp hóa đơn điện tử (chỉ thu thông tin xuất hóa đơn).
- Thông báo qua SMS, Zalo.

## Further Notes

- ADR 0007 (giữ hàng không trừ tồn, hàng rời tồn khi bàn giao) thay điều kiện "còn hàng" của ADR 0006; ADR 0008 ghi lựa chọn PayOS và hệ quả (không sandbox, không API hoàn tiền, xác nhận qua hai đường).
- GLOSSARY có mục **Mua hàng** mới (giỏ hàng, đặt mua, đơn hàng, dòng đơn, khách vãng lai, phí giao, ba trạng thái, cần đối soát, hủy đơn, phiếu soạn hàng, bàn giao vận chuyển, mã vận đơn) và **giữ hàng**, **xuất bán** ở mục Kho.
- Sự kiện thực tế về PayOS (2026-10-30, từ tài liệu chính thức): chỉ chuyển khoản Napas qua VietQR; `orderCode` là số nguyên, trùng thì lỗi; `expiredAt` là Unix timestamp; webhook ký HMAC-SHA256 trên `data`, phải trả 2xx, bước xác nhận URL webhook gọi thử vào URL nên cần URL công khai (tunnel khi chạy local); không công bố việc gửi lại hay gửi trùng webhook; trạng thái gồm `PENDING`, `PAID`, `UNDERPAID`, `CANCELLED`, `EXPIRED`, `PROCESSING`, `FAILED`; không có sandbox, không có API hoàn tiền. Tài liệu không xác nhận chuyện chuyển tiền sau khi link hết hạn, nên thiết kế coi là có thể xảy ra.
- Việc cần người làm (`ready-for-human`): có tài khoản PayOS của doanh nghiệp (xác thực CCCD, liên kết ngân hàng), điền khóa vào `.env`, chạy tunnel và xác nhận URL webhook, thử chuyển khoản thật số nhỏ.
- Migration theo quy ước hiện có: SQL viết tay, giữ `schema.prisma` đồng bộ, trigger chặn sửa xóa cho bảng chỉ ghi thêm.
- Cần chủ doanh nghiệp xác nhận:
  - thời hạn giữ hàng 15 phút;
  - tối đa 5 cái mỗi biến thể trong một đơn;
  - giới hạn 5 lần đặt mua/giờ/IP và 3 đơn chờ thanh toán mỗi email hoặc số điện thoại;
  - biểu phí giao theo tỉnh/thành, mức mặc định và ngưỡng miễn phí giao;
  - nội dung ba email gửi khách (agent viết bản nháp ở ticket 05 và 09).
  - tiền về sau hạn giữ hàng nhưng trước khi job hết hạn chạy (tối đa khoảng 1 phút) thì đơn vẫn thành đã trả (ticket 05 đã chọn, hàng vẫn đang giữ);
  - khách trả thiếu rồi chuyển lại đủ tiền: tổng nhận lớn hơn tổng đơn nên đơn bị gắn cờ và hết hạn, không khôi phục được vì spec đòi "tổng đã nhận bằng đúng tổng phải trả"; kế toán xử lý ngoài hệ thống.
- Chia ticket (2026-11-02): 16 ticket trong `issues/`, chạy bằng `/implement-spec`. Thứ tự bắt đầu: 01 → 02 → 03; ticket 13 (CI) không phụ thuộc gì nên chạy song song được. Người dùng dừng lại tự thử luồng giỏ → đặt mua → giả lập thanh toán sau ticket 05.
- **M3 xong khi:** ticket 01–15 đã resolved, test và E2E xanh, và ticket 16 (chuyển khoản thật qua PayOS) đã làm xong.
