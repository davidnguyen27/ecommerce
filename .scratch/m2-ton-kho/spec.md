# Spec: M2 — Tồn kho

**Status:** ready-for-agent

Nguồn: `project-overview.md`, phần Out of Scope của spec M0+M1 (`.scratch/m0-m1-nen-mong-danh-muc/spec.md`) và phiên làm rõ requirement ngày 2026-10-29. Đây là mốc thứ hai trong lộ trình M0 → M8 của giai đoạn 1 (mở bán).

## Problem Statement

Sau M0+M1, khách xem được sản phẩm, biến thể và giá, nhưng không biết mặt hàng nào còn hàng. Nhân viên kho cũng chưa có nơi ghi hàng về, kiểm kê hay hàng hỏng, nên số lượng thực tế chỉ nằm trong sổ tay hoặc file Excel riêng. Các mốc sau cần một nguồn tồn kho đáng tin cậy: M3 giữ hàng và trừ kho khi bán, M4 nhận đặt trước khi hết hàng.

Ngoài ra, doanh nghiệp đang có sẵn danh sách hàng hóa và số lượng tồn. Nhập tay từng sản phẩm, biến thể và ảnh qua trang quản trị tốn nhiều ngày, nên cần import hàng loạt khi bắt đầu vận hành.

## Solution

Sau mốc này:

- Mỗi biến thể có **số tồn** trong một kho duy nhất. Mọi thay đổi số tồn đều để lại một dòng trong **sổ xuất nhập** chỉ ghi thêm, ghi rõ ai làm, lúc nào, vì sao và tồn sau thay đổi bao nhiêu.
- Nhân viên kho ghi hàng về bằng **phiếu nhập** (nhiều dòng SKU và số lượng), và sửa số tồn bằng **điều chỉnh** có lý do (kiểm kê, hàng hỏng, mất hàng, khác).
- Khách thấy **Còn hàng** hoặc **Hết hàng** cho từng biến thể và trên thẻ sản phẩm. Không hiện số lượng. Dữ liệu cấu trúc Product/Offer có `availability`.
- Cuối mốc: **import file .xlsx** tạo sản phẩm nháp, biến thể và **tồn đầu kỳ**; **tải ảnh hàng loạt** ghép vào biến thể theo SKU trong tên file.

Mốc này **chưa có giỏ hàng, giữ hàng hay xuất bán** (M3) và **chưa có đặt trước** (M4).

## User Stories

### Khách hàng

1. Là khách, tôi muốn thấy biến thể tôi đang chọn còn hàng hay hết hàng, để biết có mua được không.
2. Là khách, tôi muốn biến thể hết hàng vẫn hiện trong danh sách lựa chọn nhưng được đánh dấu rõ, để biết size hoặc màu đó có tồn tại nhưng đang hết.
3. Là khách, tôi muốn khi mở trang sản phẩm thì biến thể được chọn sẵn là biến thể còn hàng, để không phải dò từng lựa chọn.
4. Là khách, tôi muốn thẻ sản phẩm trong danh mục và tìm kiếm có nhãn "Hết hàng" khi mọi biến thể đều hết, để không mất công mở trang.
5. Là khách, tôi muốn sản phẩm còn hàng được xếp trước sản phẩm hết hàng, để thấy những gì mua được trước.
6. Là khách, tôi không muốn thấy số lượng tồn chính xác. (Quyết định của doanh nghiệp: không công khai số tồn.)

### Nhân viên kho: tồn và sổ xuất nhập

7. Là nhân viên kho, tôi muốn xem danh sách tồn của mọi biến thể, tìm theo SKU hoặc tên sản phẩm, lọc theo nhóm hàng và thương hiệu, sắp xếp theo số tồn, để biết hàng nào sắp hết.
8. Là nhân viên kho, tôi muốn xem sổ xuất nhập của một biến thể hoặc của cả kho, lọc theo loại biến động và khoảng thời gian, để đối chiếu khi số liệu lệch.
9. Là nhân viên kho, tôi muốn mỗi dòng sổ ghi tồn sau thay đổi, để lần ngược được số tồn tại bất kỳ thời điểm nào.
10. Là chủ doanh nghiệp, tôi muốn sổ xuất nhập không ai sửa hay xóa được, kể cả owner, để nó có giá trị đối chiếu.

### Nhân viên kho: phiếu nhập

11. Là nhân viên kho, tôi muốn tạo phiếu nhập gồm nhiều dòng SKU và số lượng, kèm tên nhà cung cấp, ngày hàng về và ghi chú, để ghi một lô hàng về trong một lần.
12. Là nhân viên kho, tôi muốn phiếu nhập được ghi toàn bộ hoặc không ghi dòng nào, để không có phiếu ghi dở.
13. Là nhân viên kho, tôi muốn nhập được hàng cho biến thể của sản phẩm nháp, sản phẩm lưu trữ hoặc biến thể ngừng bán, vì hàng thường về trước khi lên website và hàng ngừng bán vẫn có thể còn trong kho.
14. Là chủ doanh nghiệp, tôi muốn phiếu nhập không sửa được sau khi ghi, nhập sai thì sửa bằng điều chỉnh, để lịch sử không bị viết lại.
15. Là nhân viên kho, tôi muốn xem lại danh sách phiếu nhập và chi tiết từng phiếu, để đối chiếu với hóa đơn của nhà cung cấp.

### Nhân viên kho: điều chỉnh

16. Là nhân viên kho, khi kiểm kê tôi muốn nhập số đếm thực tế và để hệ thống tự tính chênh lệch, để không phải tự trừ.
17. Là nhân viên kho, tôi muốn ghi hàng hỏng hoặc mất hàng bằng số lượng giảm, để số tồn khớp thực tế.
18. Là nhân viên kho, tôi muốn chọn lý do "khác" cho trường hợp ngoài danh sách, và hệ thống bắt buộc ghi chú, để luôn giải thích được vì sao tồn đổi.
19. Là nhân viên kho, tôi muốn hệ thống từ chối điều chỉnh làm tồn âm, để số liệu không vô lý.
20. Là nhân viên kho, tôi muốn được báo khi số tồn đã đổi trong lúc tôi đang kiểm kê (ví dụ có phiếu nhập chen vào), để đếm lại thay vì ghi đè mất phiếu nhập đó.

### Quyền và lịch sử

21. Là chủ doanh nghiệp, tôi muốn chỉ người có quyền `stock.adjust` mới nhập kho và điều chỉnh được, để không ai khác làm thay đổi tồn.
22. Là nhân viên phụ trách danh mục hoặc giá, tôi muốn xem được tồn, để tư vấn và đặt giá đúng thực tế.
23. Là chủ doanh nghiệp, tôi muốn mỗi phiếu nhập và mỗi lần điều chỉnh có trong audit log, để tra cứu cùng chỗ với các thao tác khác.

### Import và ảnh hàng loạt

24. Là nhân viên, tôi muốn tải file mẫu .xlsx sinh từ schema thuộc tính hiện tại, mỗi nhóm hàng một sheet, có sẵn danh sách thả xuống cho thương hiệu, danh mục và giá trị enum, để điền không sai.
25. Là nhân viên, tôi muốn tải file lên để xem trước: hệ thống báo lỗi theo từng dòng, từng cột mà chưa ghi gì, để sửa file trước khi ghi thật.
26. Là nhân viên, tôi muốn chỉ ghi khi cả file hợp lệ, để không phải dọn một lần import dở dang.
27. Là nhân viên, tôi muốn import tạo sản phẩm mới ở trạng thái nháp kèm biến thể và tồn đầu kỳ, để sau đó thêm ảnh, kiểm lại rồi mới xuất bản.
28. Là nhân viên, tôi muốn dòng có SKU đã tồn tại chỉ được dùng để ghi tồn đầu kỳ, không sửa thông tin sản phẩm đã có, để không ghi đè nhầm nội dung đã soạn.
29. Là chủ doanh nghiệp, tôi muốn tồn đầu kỳ chỉ ghi được một lần cho mỗi biến thể, để import chạy lại nhầm không cộng tồn hai lần.
30. Là chủ doanh nghiệp, tôi muốn import không thành cửa sau để đổi giá hoặc tồn: cột giá cần `price.edit`, cột tồn đầu kỳ cần `stock.adjust`.
31. Là nhân viên, tôi muốn chọn nhiều file ảnh tên `<SKU>.jpg` hoặc `<SKU>_<n>.jpg` để hệ thống tự gắn vào đúng sản phẩm và biến thể, để không phải tải từng ảnh.
32. Là nhân viên, tôi muốn file ảnh không khớp SKU nào bị báo lỗi và bỏ qua mà các file khác vẫn được tải, để một file sai tên không chặn cả lô.

### SEO

33. Là chủ doanh nghiệp, tôi muốn dữ liệu cấu trúc Product/Offer có `availability` đúng thực tế, để Google hiển thị đúng tình trạng hàng.

## Implementation Decisions

### Mô hình tồn kho

- **Một kho duy nhất**, không có bảng kho hay vị trí trong kho. Khi cần nhiều kho (giai đoạn 3) thì thêm cột vào sổ và bảng tồn.
- Cột `on_hand INTEGER NOT NULL DEFAULT 0` trên `product_variant`, có check constraint `on_hand >= 0`. Đây là nguồn chính thức của số tồn; M3 sẽ thêm `reserved` bên cạnh.
- Bảng **sổ xuất nhập** `stock_movement`, append-only (trigger chặn UPDATE, DELETE, TRUNCATE như `audit_log`). Mỗi dòng gồm:
  - biến thể, `seq` tăng dần để sắp xếp ổn định;
  - loại `receipt | adjustment | opening`;
  - `quantity` (khác 0, có dấu: dương là tăng, âm là giảm) và `on_hand_after`;
  - phiếu nhập (khi loại `receipt`), lý do điều chỉnh (khi loại `adjustment`), ghi chú;
  - nhân viên thực hiện, thời điểm.
- Lý do điều chỉnh là enum cố định: `stocktake` (kiểm kê), `damaged` (hàng hỏng), `lost` (mất hàng), `other` (khác, bắt buộc ghi chú).
- Mọi thay đổi số tồn đi qua một hàm duy nhất trong module kho. Hàm này khóa các dòng biến thể `FOR UPDATE` theo thứ tự id (tránh deadlock khi một phiếu có nhiều dòng), cập nhật `on_hand` và ghi dòng sổ trong cùng transaction với audit (`audited()`, ADR 0003). M3 và M6 sẽ thêm loại biến động mới qua chính hàm này.
- Tồn là việc của kho, độc lập với vòng đời hiển thị: nhập và điều chỉnh được cho mọi biến thể, kể cả của sản phẩm nháp hay lưu trữ và biến thể ngừng bán.
- Chưa ghi giá vốn (GLOSSARY "Giá vốn").

### Phiếu nhập

- Bảng `stock_receipt`, append-only: tên nhà cung cấp (chữ tự do), ngày hàng về, ghi chú, người tạo, thời điểm. Dòng phiếu chính là các dòng `stock_movement` loại `receipt` trỏ về phiếu.
- Mỗi dòng phiếu có số lượng nguyên dương. SKU không được trùng trong cùng một phiếu. SKU không tồn tại thì báo lỗi theo dòng (`lines.<i>.sku`).
- Ghi một phiếu là một transaction và một bản audit `stock.receipt.create` (after: nhà cung cấp, ngày, các dòng SKU, số lượng, tồn sau).
- Không có endpoint sửa hay xóa phiếu. Nhập sai thì làm điều chỉnh.

### Điều chỉnh

- Một lần điều chỉnh áp cho một biến thể:
  - `stocktake`: gửi `countedQuantity` (số đếm thực tế, `>= 0`); hệ thống tính chênh lệch. Số đếm bằng tồn hiện tại thì không ghi gì và trả 200 (CODING_STANDARDS: không đổi gì thì không ghi gì).
  - `damaged`, `lost`: gửi `quantity` nguyên dương là số giảm.
  - `other`: gửi `quantity` khác 0, có dấu; `note` bắt buộc.
- Mọi request điều chỉnh gửi kèm `expectedOnHand` là số tồn lúc nhân viên mở form. Tồn hiện tại khác số này thì trả 409 `CONFLICT` kèm số tồn mới, không ghi gì.
- Kết quả làm tồn âm thì trả 409, có lỗi theo trường.
- Audit `stock.adjust` (before/after: SKU, tồn, lý do, ghi chú).

### Tồn đầu kỳ

- Loại biến động `opening`, chỉ ghi được khi biến thể **chưa có dòng sổ nào**. Điều kiện này được kiểm dưới khóa dòng biến thể. Sau đó mọi thay đổi đi qua phiếu nhập hoặc điều chỉnh.
- M2 chỉ ghi tồn đầu kỳ qua import. Tồn đầu kỳ bằng 0 hoặc để trống thì không ghi gì.
- Audit `stock.opening`.

### Quyền

- Thêm permission `stock.adjust`, gán cho `warehouse`; owner có tất cả. Ghi vào bảng role trong `api/src/auth/permissions.ts` và enum `Permission` trong `@ecommerce/shared`.
- Xem tồn, sổ xuất nhập và phiếu nhập: `requirePermission('catalog.edit', 'price.edit', 'stock.adjust')`.
- Tạo phiếu nhập, điều chỉnh: `stock.adjust`.

### API

- `GET /api/admin/stock`: danh sách biến thể kèm sản phẩm, thương hiệu, nhóm hàng, trạng thái và `onHand`. Tìm theo SKU hoặc tên sản phẩm, lọc theo nhóm hàng, thương hiệu, trạng thái biến thể; sắp xếp theo tồn tăng/giảm hoặc theo tên; có phân trang.
- `GET /api/admin/stock/movements`: sổ xuất nhập, lọc theo biến thể, loại, khoảng thời gian; mới nhất trước; có phân trang.
- `POST /api/admin/stock/receipts`, `GET /api/admin/stock/receipts`, `GET /api/admin/stock/receipts/:id`.
- `POST /api/admin/stock/adjustments`.
- Chi tiết sản phẩm quản trị (`AdminProductDetail`) trả thêm `onHand` cho từng biến thể, để trang soạn sản phẩm hiện tồn (chỉ đọc, kèm liên kết sang sổ của biến thể đó).
- Schema input và output nằm trong `@ecommerce/shared` (file mới `stock.ts`).

### Phía khách

- **Ngoại lệ có chủ đích của quy tắc snapshot** (ADR 0006): tình trạng còn hàng không nằm trong `product_version.snapshot` mà đọc trực tiếp từ `product_variant.on_hand`, chỉ cho các biến thể có trong snapshot đang xuất bản. Cập nhật mục "Snapshot đã xuất bản" của `CODING_STANDARDS.md` để ghi ngoại lệ này.
- Khách chỉ thấy boolean: biến thể còn hàng khi `on_hand > 0`; sản phẩm còn hàng khi có ít nhất một biến thể trong snapshot còn hàng. API công khai không bao giờ trả số tồn.
- `PublicProduct.variants[]` thêm `inStock: boolean`; `ProductCard` thêm `inStock: boolean`.
- Trang sản phẩm:
  - Mỗi lựa chọn biến thể hết hàng hiện mờ kèm chữ "Hết hàng", nhưng vẫn chọn được.
  - Không có `?sku=` (hoặc SKU sai) thì chọn sẵn biến thể đầu tiên còn hàng; hết cả thì chọn biến thể đầu tiên như hiện nay.
  - Hiện "Còn hàng" hoặc "Hết hàng" cạnh giá của biến thể đang chọn.
- Thẻ sản phẩm (`ProductCardGrid`): nhãn "Hết hàng" khi sản phẩm hết hàng. Giá "từ X" giữ nguyên cách tính hiện tại (giá thấp nhất trong các biến thể đang bán, từ snapshot), không phụ thuộc tồn.
- Tìm kiếm và danh sách (`api/src/catalog/search.ts`): thứ tự sắp xếp là ưu tiên SKU khớp (như hiện nay), rồi **còn hàng trước hết hàng**, rồi theo cách sắp xếp khách chọn. Facets và tổng số không đổi. Chưa có bộ lọc "chỉ còn hàng".
- Cache `swr: 60` hiện có của `/san-pham/**` và `/danh-muc/**` giữ nguyên: tình trạng hàng trên website có thể trễ tối đa khoảng 60 giây. Kiểm tra tồn chính xác lúc đặt mua là việc của M3.

### SEO

- `web/app/utils/seo.ts`: `Offer` có `availability` `https://schema.org/InStock` hoặc `OutOfStock` theo biến thể. Với `AggregateOffer`, `availability` là `InStock` khi có ít nhất một biến thể còn hàng.

### Trang quản trị

- Menu nhóm mới **Kho** gồm: Tồn kho (danh sách, lọc, nút điều chỉnh mở form theo biến thể), Phiếu nhập (danh sách, tạo phiếu với các dòng thêm theo SKU, xem chi tiết), Sổ xuất nhập. Tên hành động audit mới được bổ sung vào `web/app/utils/auditLabels.ts`.
- Menu hiện theo quyền như các trang hiện có (`useAdminSession().can`).

### Import .xlsx

- Thư viện `exceljs` ở API, dùng để sinh file mẫu (có data validation cho danh sách thả xuống) và đọc file tải lên.
- `GET /api/admin/import/template`: file mẫu sinh từ dữ liệu hiện tại, **mỗi nhóm hàng một sheet**. Mỗi dòng là một biến thể; các dòng cùng `slug` thuộc cùng một sản phẩm. Cột gồm:
  - cấp sản phẩm: slug, tên, thương hiệu, danh mục, mã mẫu, mô tả, hướng dẫn sử dụng/bảo quản, thông tin nguồn gốc công bố, chỉ giao đường bộ, và mỗi thuộc tính cấp sản phẩm trong schema một cột;
  - cấp biến thể: SKU, mỗi thuộc tính cấp biến thể một cột, giá bán, giá hãng, tồn đầu kỳ.

  Bảng size, trang chính sách, cam kết và ảnh không có trong file.
- Thương hiệu và danh mục ghép theo tên (danh sách thả xuống lấy từ dữ liệu hiện có, danh mục chỉ gồm các danh mục của nhóm hàng của sheet). Import không tạo thương hiệu hay danh mục mới. multi_enum ghi các giá trị cách nhau bằng dấu `;`.
- Hai bước, không lưu trạng thái giữa hai bước:
  - `POST /api/admin/import/preview` (multipart): kiểm toàn bộ file, trả số sản phẩm và biến thể sẽ tạo, số biến thể sẽ ghi tồn đầu kỳ, và danh sách lỗi dạng `{ sheet, row, column, message }`. Không ghi gì.
  - `POST /api/admin/import/commit` (multipart, gửi lại chính file đó): kiểm lại trong một transaction dưới các khóa như khi ghi thường (schema thuộc tính `FOR SHARE`, biến thể `FOR UPDATE`), rồi ghi toàn bộ. Có bất kỳ lỗi nào thì không ghi gì và trả lỗi như bước xem trước.
- Dòng có SKU **chưa tồn tại**: tạo sản phẩm (nếu slug chưa có) ở trạng thái **nháp** và biến thể, kiểm theo đúng các luật của M1 (thuộc tính theo schema, SKU duy nhất, tổ hợp duy nhất, giá hãng `>=` giá bán). Slug đã thuộc về một sản phẩm có sẵn thì báo lỗi (import không thêm biến thể vào sản phẩm đã có). Các dòng cùng slug phải giống nhau ở mọi cột cấp sản phẩm.
- Dòng có SKU **đã tồn tại**: chỉ dùng cột tồn đầu kỳ, theo luật một lần ở trên; biến thể đã có dòng sổ thì báo lỗi theo dòng. Các cột khác được bỏ qua và bước xem trước liệt kê những dòng này thành cảnh báo "chỉ ghi tồn đầu kỳ".
- Quyền: cần `catalog.edit`. File có điền ô giá nào thì cần thêm `price.edit`; có điền ô tồn đầu kỳ nào thì cần thêm `stock.adjust`. Thiếu quyền thì trả 403 cho cả file, kèm lý do.
- Giới hạn 2.000 dòng biến thể và 5 MB mỗi file; kiểm MIME thật như module media.
- Audit: dùng đúng các hành động của M1 cho từng đối tượng được tạo (`catalog.product.create`, `catalog.variant.create`, `price.change`) và `stock.opening`, trong cùng transaction. Thêm một bản `catalog.import` tóm tắt (tên file, số sản phẩm, biến thể, tồn đầu kỳ) để lọc audit theo lần import.
- Trang quản trị: trang Import gồm tải file mẫu, chọn file, bảng kết quả xem trước, và nút xác nhận chỉ bật khi không có lỗi.

### Ảnh hàng loạt theo SKU

- `POST /api/admin/images/by-sku` (multipart, một file mỗi request), quyền `media.upload`. Tên file `<SKU>.<đuôi>` hoặc `<SKU>_<n>.<đuôi>`, SKU so khớp không phân biệt hoa thường.
- Ảnh được gắn vào sản phẩm của SKU đó và gắn với chính biến thể đó, nối sau các ảnh hiện có. Thứ tự giữa các ảnh của cùng SKU theo `n` (không có `n` là 0). Xử lý ảnh và kiểm tra file dùng lại module media hiện có (sinh cỡ webp, bỏ EXIF, kiểm MIME và dung lượng). Audit như tải ảnh từng cái.
- Trang quản trị gửi lần lượt từng file, hiện tiến độ, và cuối cùng hiện danh sách file lỗi (không khớp SKU, sai định dạng, quá dung lượng). Không có cơ chế ghi tất cả hoặc không ghi gì: mỗi file độc lập.

## Testing Decisions

- Giữ nguyên seam của M0+M1: HTTP qua supertest trên Postgres thật (Testcontainers); storage và mailer là bản giả trong bộ nhớ. `prisma` trong test chỉ để dựng trạng thái, kết quả kiểm qua HTTP (CODING_STANDARDS "Test").
- Các hành vi bắt buộc có test:
  - **Phiếu nhập:** tạo phiếu làm tăng tồn và sinh dòng sổ có `on_hand_after` đúng; SKU không tồn tại hoặc trùng trong phiếu thì lỗi theo dòng và không dòng nào được ghi; nhập được cho biến thể của sản phẩm nháp và biến thể ngừng bán; không có cách sửa hay xóa phiếu.
  - **Điều chỉnh:** kiểm kê tính đúng chênh lệch; kiểm kê bằng tồn hiện tại thì không có dòng sổ và audit; hỏng/mất giảm đúng; `other` thiếu ghi chú bị từ chối; làm tồn âm bị 409; `expectedOnHand` lệch bị 409 và không ghi gì.
  - **Sổ xuất nhập:** không có cách sửa hay xóa (trigger); lọc theo biến thể, loại, thời gian.
  - **Đồng thời:** hai phiếu nhập cùng biến thể chạy song song cho tổng đúng; hai lần giảm song song không làm tồn âm.
  - **Quyền:** không có `stock.adjust` thì không tạo được phiếu hay điều chỉnh (403); có `catalog.edit` hoặc `price.edit` thì xem được tồn; audit có đủ bản ghi.
  - **Phía khách:** API công khai trả `inStock` đúng và không lộ số tồn; sản phẩm hết hàng vẫn có trong tìm kiếm và đứng sau sản phẩm còn hàng; tồn đổi không tạo phiên bản sản phẩm mới; biến thể không có trong snapshot không ảnh hưởng `inStock` của sản phẩm.
  - **Import:** file hợp lệ tạo sản phẩm nháp, biến thể, giá, tồn đầu kỳ; một dòng lỗi thì không ghi gì; xem trước không ghi gì; tồn đầu kỳ cho biến thể đã có dòng sổ bị lỗi; slug trùng sản phẩm có sẵn bị lỗi; thiếu `price.edit` hoặc `stock.adjust` khi có điền cột tương ứng thì 403; thuộc tính sai schema báo lỗi đúng sheet, dòng, cột; quá giới hạn dòng bị từ chối.
  - **Ảnh theo SKU:** tên file đúng gắn vào đúng biến thể và đúng thứ tự; SKU không tồn tại thì lỗi; thiếu `media.upload` thì 403.
- `scripts/smoke.ts`: thêm kiểm tra nhãn còn/hết hàng trên trang sản phẩm và `availability` trong JSON-LD (CODING_STANDARDS "Web").
- Chưa có E2E; Playwright bắt đầu từ M3 như đã định.

## Out of Scope

- Giỏ hàng, giữ hàng, xuất bán, kiểm tra tồn lúc đặt mua (M3). Đặt trước khi hết hàng (M4). Nhập lại kho từ đổi trả, giao thất bại (M6).
- Nhiều kho, vị trí trong kho, chuyển kho (giai đoạn 3).
- Giá vốn, báo cáo xuất nhập tồn, xuất tồn ra Excel (M7).
- Danh bạ nhà cung cấp, đính file vào phiếu nhập.
- Cảnh báo sắp hết hàng cho nhân viên; thông báo hàng về cho khách (giai đoạn 2); hiện "chỉ còn N".
- Bộ lọc "chỉ còn hàng" trên website.
- Import cập nhật thông tin hoặc giá của sản phẩm đã có; import thương hiệu, danh mục, bảng size, chính sách, cam kết.

## Further Notes

- Quyết định đọc tồn trực tiếp thay vì từ snapshot ghi ở `docs/adr/0006-ton-kho-doc-truc-tiep-khong-qua-snapshot.md` (2026-10-29).
- Thuật ngữ mới (sổ xuất nhập, phiếu nhập, điều chỉnh, tồn đầu kỳ, còn hàng/hết hàng) đã thêm vào `GLOSSARY.md`. Lưu ý GLOSSARY tách **Hết hàng** (tồn bằng 0) khỏi **Ngừng bán** (biến thể không còn bán).
- Migration theo quy ước của M1: viết SQL tay, giữ `schema.prisma` đồng bộ.
- Cần chủ doanh nghiệp xác nhận:
  - danh sách lý do điều chỉnh (kiểm kê, hàng hỏng, mất hàng, khác);
  - không công khai số tồn, và xếp sản phẩm hết hàng xuống sau;
  - giới hạn import 2.000 dòng và 5 MB.
- Spec M0+M1 ghi lộ trình "M0 → M9"; lộ trình thực tế kết thúc ở M8 (chatbot).
