# Bán lẻ thời trang nhập khẩu

Website bán lẻ của một doanh nghiệp nhập khẩu và trực tiếp bán giày dép, quần áo, đồng hồ, túi xách, nước hoa của các thương hiệu nổi tiếng cho khách tại Việt Nam.

## Danh mục hàng hóa

**Nhóm hàng** (Product type):
Một trong năm loại hàng cố định: giày dép, quần áo, đồng hồ, túi xách, nước hoa. Nhóm hàng quyết định bộ thuộc tính mà sản phẩm phải khai báo.
_Avoid_: loại hàng, ngành hàng

**Danh mục** (Category):
Một nút trong cây phân loại để khách duyệt hàng, luôn nằm trọn trong đúng một nhóm hàng. Gốc cây chính là các nhóm hàng.
_Avoid_: nhóm hàng (khi nói về nút trong cây)

**Bộ sưu tập** (Collection):
Tập sản phẩm gom thủ công, có thể thuộc nhiều nhóm hàng (ví dụ "Hàng mới về"). Chưa có ở giai đoạn hiện tại.

**Thương hiệu** (Brand):
Nhà sản xuất hoặc nhãn hàng của sản phẩm, không phải doanh nghiệp bán.

**Schema thuộc tính** (Attribute schema):
Danh sách định nghĩa thuộc tính của một nhóm hàng; mọi danh mục trong nhóm hàng dùng chung, không mở rộng riêng theo danh mục.

**Giới tính** (Gender):
Thuộc tính cấp sản phẩm có ở mọi nhóm hàng, nhận một trong ba giá trị Nam, Nữ, Unisex. Sản phẩm Unisex thuộc về cả Nam lẫn Nữ khi khách duyệt hoặc lọc.
_Avoid_: đối tượng, phái

**Thuộc tính cấp sản phẩm** / **Thuộc tính cấp biến thể**:
Thuộc tính có một giá trị chung cho cả sản phẩm (ví dụ chất liệu), hoặc thuộc tính phân biệt các biến thể với nhau (ví dụ màu, size, dung tích).

**Sản phẩm** (Product):
Một mẫu hàng của một thương hiệu, có chung mô tả, ảnh và thông tin nguồn gốc; khách không mua trực tiếp sản phẩm mà mua một biến thể của nó.
_Avoid_: mặt hàng, item

**Biến thể** (Variant):
Lựa chọn cụ thể mà khách mua, xác định bởi tổ hợp thuộc tính cấp biến thể, ví dụ giày màu đen size 40 hoặc nước hoa 100 ml.
_Avoid_: option, phiên bản

**Mã mẫu** (Model code):
Mã do hãng đặt cho một mẫu, ở cấp sản phẩm, ví dụ `SRPD55K1`. Khách có thể tìm theo mã này.
_Avoid_: mã hàng, mã sản phẩm

**SKU**:
Mã nội bộ do doanh nghiệp đặt cho một biến thể, duy nhất trong toàn hệ thống.
_Avoid_: mã hàng, mã biến thể

## Giá

**Giá bán** (Price):
Số tiền khách trả cho một biến thể, tính bằng VND và đã gồm VAT.

**Giá hãng** (Compare-at price):
Giá bán lẻ chính thức do thương hiệu công bố, hiển thị gạch ngang kèm nhãn "Giá hãng" cạnh giá bán; không bắt buộc và không thấp hơn giá bán. Không phải giá trước khuyến mại.
_Avoid_: giá gốc, giá niêm yết, giá cũ, giá trước giảm

**Giá vốn** (Cost):
Số tiền doanh nghiệp bỏ ra để có hàng. Chưa dùng ở giai đoạn hiện tại.
_Avoid_: giá gốc, giá nhập

## Trạng thái hiển thị

**Ẩn** (Hidden):
Thương hiệu hoặc danh mục tạm không có trong menu và không có trang riêng; bỏ ẩn được bất cứ lúc nào. Ẩn không ảnh hưởng tới việc sản phẩm có hiện hay không.

**Nháp** / **Đã xuất bản** / **Lưu trữ** (Draft / Published / Archived):
Vòng đời của sản phẩm. Chỉ sản phẩm đã xuất bản mới hiện với khách; sản phẩm lưu trữ là hàng không còn kinh doanh nhưng giữ nguyên lịch sử. Lưu trữ là cách duy nhất để gỡ một sản phẩm đã xuất bản khỏi website.
_Avoid_: xóa, ẩn (khi nói về sản phẩm)

**Ngừng bán** (Discontinued):
Biến thể không còn được bán, dù sản phẩm của nó vẫn đã xuất bản.
_Avoid_: ngừng hoạt động, inactive, hết hàng

## Kho

**Tồn** (On hand):
Số lượng thực có trong kho của một biến thể. Chỉ có một kho.
_Avoid_: tồn kho của sản phẩm (tồn luôn ở cấp biến thể)

**Còn hàng** / **Hết hàng** (In stock / Out of stock):
Điều khách thấy về một biến thể: còn hàng khi tồn trừ số đang giữ hàng lớn hơn 0. Sản phẩm còn hàng khi có ít nhất một biến thể đang hiện với khách còn hàng. Khách không thấy số lượng.
_Avoid_: ngừng bán (khi nói về hết hàng)

**Giữ hàng** (Reservation):
Số lượng của một biến thể đã thuộc về một đơn nhưng chưa rời kho. Giữ hàng không làm giảm tồn; hàng chỉ rời tồn khi bàn giao vận chuyển.
_Avoid_: đặt giữ, khóa hàng, trừ kho (khi hàng chưa rời kho)

**Xuất bán** (Sale issue):
Loại biến động trong sổ xuất nhập khi hàng của một đơn rời kho lúc bàn giao vận chuyển.
_Avoid_: trừ kho, xuất hàng

**Sổ xuất nhập** (Stock ledger):
Danh sách chỉ ghi thêm mọi lần tồn thay đổi: biến thể, số lượng tăng hoặc giảm, tồn sau thay đổi, loại biến động, người làm và thời điểm.
_Avoid_: lịch sử kho, thẻ kho

**Phiếu nhập** (Stock receipt):
Một lần ghi hàng về kho, gồm nhiều dòng SKU và số lượng, kèm nhà cung cấp và ngày hàng về. Không sửa được sau khi ghi.
_Avoid_: đơn nhập, phiếu nhập hàng (khi nói về đơn đặt hàng với nhà cung cấp)

**Điều chỉnh** (Stock adjustment):
Thay đổi tồn ngoài nhập kho và bán hàng, luôn kèm một lý do: kiểm kê, hàng hỏng, mất hàng hoặc khác.

**Tồn đầu kỳ** (Opening stock):
Số tồn ghi lần đầu cho một biến thể khi bắt đầu dùng hệ thống; chỉ ghi được khi biến thể chưa có dòng nào trong sổ xuất nhập.

## Mua hàng

**Giỏ hàng** (Cart):
Danh sách biến thể và số lượng khách định mua, chỉ nằm ở trình duyệt của khách. Giỏ hàng không giữ hàng và không có giá chốt.
_Avoid_: đơn nháp

**Đặt mua** (Checkout):
Lần khách xác nhận giỏ hàng cùng thông tin nhận hàng; hệ thống kiểm lại giá và tồn rồi tạo đơn hàng.
_Avoid_: thanh toán (khi nói về bước tạo đơn)

**Đơn hàng** (Order):
Cam kết mua của khách, ghi lại các dòng đơn, địa chỉ nhận hàng, phí giao, tổng tiền và phiên bản chính sách tại thời điểm đặt mua; sửa giá hay chính sách sau đó không làm đơn thay đổi.
_Avoid_: đơn đặt hàng, giao dịch

**Dòng đơn** (Order line):
Một biến thể trong đơn hàng với số lượng và giá bán tại thời điểm đặt mua.

**Khách vãng lai** (Guest):
Khách đặt mua mà không đăng nhập; tra cứu đơn qua link gửi tới email đã nhập.

**Phí giao** (Shipping fee):
Số tiền giao hàng tính theo tỉnh/thành nhận hàng, ghi vào đơn lúc đặt mua.
_Avoid_: phí ship, phí vận chuyển

**Trạng thái đơn hàng** / **Trạng thái thanh toán** / **Trạng thái giao hàng**:
Ba khía cạnh theo dõi độc lập của một đơn. Đã trả đủ không có nghĩa là đã giao; đã bàn giao không có nghĩa là đã giao tới khách.

**Cần đối soát** (Needs reconciliation):
Đơn có khoản tiền về không khớp với đơn: lệch số tiền, hoặc về khi đơn đã hết hạn hay đã hủy. Hệ thống không tự xử lý; nhân viên quyết định giữ lại hàng hay hoàn tiền.
_Avoid_: lỗi thanh toán, đơn treo

**Hủy đơn** (Order cancellation):
Kết thúc một đơn chưa thanh toán, do khách tự hủy, nhân viên hủy hoặc đơn hết thời hạn giữ hàng; hàng đang giữ được nhả. Không phải hoàn tiền.
_Avoid_: hoàn đơn, xóa đơn

**Phiếu soạn hàng** (Packing slip):
Trang in cho nhân viên kho lấy đúng SKU và số lượng của một đơn, kèm địa chỉ nhận.
_Avoid_: phiếu xuất kho

**Bàn giao vận chuyển** (Handover):
Lúc nhân viên kho giao kiện hàng cho đơn vị vận chuyển và ghi mã vận đơn; hàng rời tồn tại thời điểm này.
_Avoid_: xuất kho, gửi hàng

**Mã vận đơn** (Tracking number):
Mã của đơn vị vận chuyển cho một kiện hàng, nhân viên nhập tay.
_Avoid_: mã đơn

## Nguồn gốc và cam kết

**Thông tin nguồn gốc công bố** (Origin statement):
Lời doanh nghiệp tự công bố về nguồn gốc sản phẩm, không kèm bằng chứng.

**Chứng từ** (Document):
Tài liệu nội bộ chứng minh nguồn hàng, như hóa đơn nhập hoặc giấy tờ nhà cung cấp; không bao giờ công khai.

**Cam kết có bằng chứng** (Evidenced commitment):
Cam kết của doanh nghiệp về một sản phẩm, thuộc một loại cam kết và dựa trên ít nhất một chứng từ. Bảo hành chính hãng là một loại cam kết có bằng chứng; không có cách nào hiện bảo hành mà không có chứng từ.
_Avoid_: thông tin bảo hành đã xác nhận

**Loại cam kết** (Commitment type):
Một mục trong danh sách cố định các kiểu cam kết mà doanh nghiệp được phép đưa ra, ví dụ Bảo hành chính hãng, Bảo hành quốc tế, Có hóa đơn nhập khẩu.

## Nội dung

**Trang chính sách** (Policy page):
Trang nội dung loại chính sách, như đổi trả hoặc bảo hành. Sản phẩm liên kết tới trang chính sách, không liên kết tới một phiên bản cụ thể.

**Phiên bản chính sách** (Policy version):
Nội dung của một trang chính sách tại một lần xuất bản; được giữ lại để đơn hàng và lời đồng ý của khách tham chiếu đúng nội dung tại thời điểm đó.
