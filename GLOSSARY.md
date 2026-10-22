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
Vòng đời của sản phẩm. Chỉ sản phẩm đã xuất bản mới hiện với khách; sản phẩm lưu trữ là hàng không còn kinh doanh nhưng giữ nguyên lịch sử.
_Avoid_: xóa, ẩn (khi nói về sản phẩm)

**Ngừng bán** (Discontinued):
Biến thể không còn được bán, dù sản phẩm của nó vẫn đã xuất bản.
_Avoid_: ngừng hoạt động, inactive, hết hàng

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
