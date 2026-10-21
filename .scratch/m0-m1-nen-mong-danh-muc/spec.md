# Spec: M0 + M1 — Nền móng hệ thống và danh mục sản phẩm

**Status:** ready-for-agent

Nguồn: `project-overview.md` và phiên làm rõ requirement ngày 2026-10-21. Đây là spec đầu tiên trong lộ trình M0 → M9 của giai đoạn 1 (mở bán).

## Problem Statement

Doanh nghiệp nhập khẩu và bán lẻ hàng hiệu (giày dép, quần áo, đồng hồ, túi xách, nước hoa) chưa có website. Trước khi bán được bất cứ thứ gì, họ cần hai thứ:

- **Nhân viên** phải có một nơi tập trung để quản lý thương hiệu, danh mục, sản phẩm, biến thể, giá và hình ảnh. Mỗi nhóm hàng có bộ thuộc tính khác nhau: giày có hệ size, nước hoa có dung tích và nồng độ, đồng hồ có bộ máy. Hệ thống không được ép mọi sản phẩm dùng chung một bộ trường. Việc sửa giá phải giới hạn cho đúng người và luôn tra lại được ai đã sửa gì.
- **Khách** phải xem, tìm và lọc được sản phẩm trên điện thoại mà không cần đăng nhập. Tìm được bằng tiếng Việt không dấu, theo tên, theo mã, theo thương hiệu. Khách thấy rõ từng biến thể (màu, size, dung tích) và giá của nó, cùng các thông tin nguồn gốc và chính sách do doanh nghiệp công bố.

Ngoài ra, chưa có nền tảng kỹ thuật: tài khoản, phân quyền, lịch sử thao tác, lưu trữ file, sao lưu, giám sát. Mọi mốc sau (kho, mua hàng, đặt cọc, thanh toán) đều dựa trên nền này. Chỉ một người phát triển và vận hành, nên nền móng phải ít thành phần và dễ vận hành.

## Solution

Sau mốc này, sản phẩm có:

- **Website khách hàng** (Nuxt, chạy SSR, ưu tiên điện thoại): trang chủ tối giản, trang danh mục, trang thương hiệu, tìm kiếm, trang chi tiết sản phẩm, các trang nội dung (giới thiệu, quy trình nhập/kiểm tra hàng, chính sách), và đăng ký / đăng nhập / quên mật khẩu.
- **Trang quản trị** tại `/admin` (Nuxt SPA): đăng nhập nhân viên, quản lý nhân viên và role, quản lý thương hiệu, danh mục và schema thuộc tính của từng nhóm hàng, soạn sản phẩm và biến thể, tải ảnh và chứng từ, soạn trang nội dung, xem audit log.
- **API** (Express) là nguồn dữ liệu chính thức duy nhất.
  - Xác thực bằng JWT: access token sống ngắn, refresh token có rotation và thu hồi được.
  - Khách và nhân viên dùng hai miền xác thực tách biệt.
  - Phân quyền theo permission.
  - Mọi thao tác nhạy cảm đều ghi audit log.
- **Hạ tầng**:
  - Ba môi trường local, staging, production chạy Docker Compose trên VPS, phía sau Caddy.
  - Ảnh và chứng từ lưu trên object storage tương thích S3 (R2).
  - Mỗi đêm sao lưu Postgres, mã hóa và đẩy lên R2.
  - Giám sát lỗi bằng Sentry, kiểm tra sức khỏe hệ thống qua `/healthz`.

Mốc này **chưa có tồn kho, chưa có mua hàng**. Trang sản phẩm hiển thị giá và biến thể, nhưng chưa hiển thị tình trạng còn hàng hay đặt trước; phần đó thuộc M2 và M4.

## User Stories

### Khách hàng: xem và tìm sản phẩm

1. Là khách, tôi muốn xem danh mục sản phẩm mà không cần đăng nhập, để tìm hiểu trước khi quyết định mua.
2. Là khách, tôi muốn duyệt sản phẩm theo nhóm hàng (giày dép, quần áo, đồng hồ, túi xách, nước hoa), để chỉ thấy đúng loại hàng mình quan tâm.
3. Là khách, tôi muốn duyệt sản phẩm theo thương hiệu, để xem toàn bộ hàng của một hãng tôi tin dùng.
4. Là khách, tôi muốn tìm theo tên sản phẩm bằng tiếng Việt không dấu (gõ "giay da" vẫn ra "giày da"), để không phải gõ dấu trên điện thoại.
5. Là khách, tôi muốn tìm theo mã mẫu hoặc SKU, để tra đúng mẫu tôi đã thấy ở nơi khác.
6. Là khách, tôi muốn kết quả vẫn ra khi tôi gõ sai chính tả nhẹ hoặc chỉ gõ một phần tên, để không bị trang "không tìm thấy".
7. Là khách, tôi muốn lọc theo khoảng giá, để chỉ xem hàng trong ngân sách.
8. Là khách, tôi muốn lọc theo thuộc tính riêng của nhóm hàng (size giày, màu, dung tích nước hoa, chất liệu túi, loại bộ máy đồng hồ), để thu hẹp đúng nhu cầu.
9. Là khách, tôi muốn bộ lọc chỉ hiển thị những thuộc tính áp dụng cho nhóm hàng đang xem, để không bị rối bởi các lựa chọn vô nghĩa.
10. Là khách, tôi muốn sắp xếp kết quả theo mới nhất hoặc theo giá tăng/giảm, để dễ so sánh.
11. Là khách, tôi muốn danh sách được phân trang và tải nhanh trên điện thoại, để duyệt thoải mái bằng 4G.
12. Là khách, tôi muốn thấy trên thẻ sản phẩm giá thấp nhất trong các biến thể ("từ 2.500.000 ₫") và giá gốc gạch ngang nếu đang giảm, để đánh giá nhanh.

### Khách hàng: chi tiết sản phẩm

13. Là khách, tôi muốn xem nhiều ảnh lớn của sản phẩm, để quan sát kỹ trước khi mua.
14. Là khách, tôi muốn chọn biến thể (màu, size, dung tích) và thấy giá, mã hàng, ảnh của đúng biến thể đó, để biết chính xác mình đang xem gì.
15. Là khách, tôi muốn biến thể chỉ cho chọn những tổ hợp có thật (ví dụ size 40 chỉ có màu đen), để không chọn phải tổ hợp không tồn tại.
16. Là khách, tôi muốn thấy giá gốc và giá bán của từng biến thể, để biết mức giảm.
17. Là khách, tôi muốn xem các thông số đặc trưng của nhóm hàng (mặt đồng hồ, bộ máy, nồng độ nước hoa, nhóm hương, kích thước túi, phụ kiện đi kèm), để so sánh.
18. Là khách, tôi muốn xem bảng size và hướng dẫn chọn size của sản phẩm giày và quần áo, để chọn vừa.
19. Là khách, tôi muốn xem hướng dẫn sử dụng và bảo quản, để dùng sản phẩm đúng cách.
20. Là khách, tôi muốn xem thông tin nguồn gốc do doanh nghiệp công bố, có phân biệt rõ với những cam kết đã có bằng chứng xác nhận, để biết mức độ tin cậy.
21. Là khách, tôi muốn thấy thông tin bảo hành chỉ khi sản phẩm đó thật sự có bảo hành được xác nhận, để không bị hiểu nhầm là mọi sản phẩm đều có bảo hành chính hãng.
22. Là khách, tôi muốn có liên kết tới chính sách đổi trả và bảo hành áp dụng cho sản phẩm, để hiểu điều kiện trước khi mua.
23. Là khách, tôi muốn mỗi biến thể có đường dẫn riêng chia sẻ được, để gửi đúng mẫu cho bạn bè.

### Khách hàng: nội dung và tài khoản

24. Là khách, tôi muốn đọc trang giới thiệu doanh nghiệp và quy trình nhập/kiểm tra hàng, để tin vào nguồn hàng.
25. Là khách, tôi muốn đọc chính sách bảo mật, đổi trả, bảo hành, giao hàng và đặt cọc, để biết quyền lợi của mình.
26. Là khách, tôi muốn thấy thông tin pháp lý của doanh nghiệp và logo đã thông báo Bộ Công Thương ở chân trang, để yên tâm đây là website hợp pháp.
27. Là khách, tôi muốn đăng ký tài khoản bằng email và mật khẩu, kèm ô đồng ý chính sách xử lý dữ liệu cá nhân, để quản lý thông tin mua hàng sau này.
28. Là khách, tôi muốn nhận email xác minh địa chỉ email sau khi đăng ký, để chứng minh email là của tôi.
29. Là khách, tôi muốn đăng nhập và giữ phiên đăng nhập trên điện thoại nhiều ngày, để không phải đăng nhập lại liên tục.
30. Là khách, tôi muốn đặt lại mật khẩu qua email khi quên, để lấy lại tài khoản.
31. Là khách, tôi muốn khi đổi mật khẩu thì mọi thiết bị khác bị đăng xuất, để an toàn nếu tài khoản từng bị lộ.
32. Là khách, tôi muốn đăng xuất khỏi thiết bị hiện tại, để không ai dùng máy tôi truy cập tài khoản.

### Nhân viên: tài khoản, quyền và lịch sử

33. Là chủ doanh nghiệp, tôi muốn có tài khoản owner đầu tiên được tạo khi cài đặt hệ thống, để bắt đầu quản trị.
34. Là chủ doanh nghiệp, tôi muốn tạo tài khoản nhân viên và gán một hoặc nhiều role (owner, sales, warehouse, accountant), để một người kiêm nhiều việc trong giai đoạn đầu.
35. Là chủ doanh nghiệp, tôi muốn nhân viên không tự đăng ký được, để chỉ người tôi cho phép mới vào được trang quản trị.
36. Là chủ doanh nghiệp, tôi muốn khóa tài khoản nhân viên và mọi phiên của họ mất hiệu lực ngay, để xử lý khi nhân viên nghỉ việc.
37. Là chủ doanh nghiệp, tôi muốn khi tôi đổi role của nhân viên thì quyền mới có hiệu lực ngay ở request kế tiếp, để không có khoảng hở quyền.
38. Là nhân viên, tôi muốn phiên đăng nhập quản trị hết hạn sau ca làm việc, để giảm rủi ro khi quên đăng xuất.
39. Là nhân viên, tôi muốn chỉ thấy và dùng được những chức năng role của tôi cho phép, để không thao tác nhầm vào việc ngoài trách nhiệm.
40. Là chủ doanh nghiệp, tôi muốn token của tài khoản khách không bao giờ truy cập được API quản trị, kể cả khi cùng email với nhân viên, để tách bạch hai miền.
41. Là chủ doanh nghiệp, tôi muốn mọi thao tác nhạy cảm (sửa giá, tạo/sửa/xóa sản phẩm, đổi role, khóa nhân viên, sửa nội dung chính sách) được ghi lại: ai làm, lúc nào, trước và sau ra sao, để tra cứu khi có sai sót.
42. Là chủ doanh nghiệp, tôi muốn xem và lọc audit log theo người, theo loại đối tượng, theo thời gian, để điều tra nhanh.
43. Là chủ doanh nghiệp, tôi muốn audit log không ai sửa hay xóa được, kể cả owner, để nó có giá trị đối chiếu.

### Nhân viên: danh mục

44. Là nhân viên phụ trách danh mục, tôi muốn quản lý thương hiệu (tên, slug, logo, mô tả), để khách duyệt theo thương hiệu.
45. Là nhân viên phụ trách danh mục, tôi muốn quản lý cây danh mục có danh mục con (ví dụ Giày dép > Sneaker), để tổ chức hàng hóa.
46. Là chủ doanh nghiệp, tôi muốn mỗi nhóm hàng có schema thuộc tính riêng (tên, kiểu dữ liệu, bắt buộc hay không, danh sách giá trị cho phép, đơn vị, áp dụng ở cấp sản phẩm hay cấp biến thể, có dùng làm bộ lọc không), để thông tin đúng đặc thù từng loại hàng.
47. Là nhân viên, tôi muốn hệ thống từ chối lưu sản phẩm thiếu thuộc tính bắt buộc hoặc có giá trị không hợp lệ theo schema, và báo rõ lỗi ở trường nào, để dữ liệu luôn sạch.
48. Là nhân viên, tôi muốn tạo sản phẩm ở trạng thái nháp, xem trước, rồi mới xuất bản, để khách không thấy sản phẩm chưa hoàn thiện.
49. Là nhân viên, tôi muốn ẩn hoặc lưu trữ một sản phẩm mà không mất lịch sử, để ngừng hiển thị hàng không còn kinh doanh.
50. Là nhân viên, tôi muốn tạo các biến thể cho một sản phẩm từ các thuộc tính cấp biến thể (màu × size), mỗi biến thể có SKU duy nhất, để quản lý đúng mặt hàng cụ thể khách mua.
51. Là nhân viên, tôi muốn hệ thống từ chối hai biến thể trùng tổ hợp thuộc tính hoặc trùng SKU, để không có hàng trùng.
52. Là nhân viên được cấp quyền sửa giá, tôi muốn đặt giá bán và giá gốc cho từng biến thể, để phản ánh khuyến mãi thủ công.
53. Là chủ doanh nghiệp, tôi muốn chỉ người có quyền sửa giá mới đổi được giá, và giá bán không bao giờ lớn hơn giá gốc, để tránh sai sót.
54. Là nhân viên, tôi muốn soạn mô tả, hướng dẫn sử dụng/bảo quản, bảng size, thông tin nguồn gốc công bố và thông tin bảo hành đã xác nhận cho từng sản phẩm, để trang sản phẩm đầy đủ.
55. Là nhân viên, tôi muốn gắn các chính sách áp dụng (đổi trả, bảo hành) vào sản phẩm, để khách đọc đúng chính sách cho mặt hàng đó.
56. Là nhân viên, tôi muốn đánh dấu sản phẩm "chỉ giao đường bộ" (nước hoa), để các mốc vận chuyển sau dùng được.
57. Là nhân viên, tôi muốn tải nhiều ảnh lên một sản phẩm, sắp xếp thứ tự và gắn ảnh vào biến thể cụ thể, để khách đổi màu thì đổi ảnh.
58. Là nhân viên, tôi muốn hệ thống từ chối file không phải ảnh hoặc quá dung lượng cho phép, để không làm chậm website.
59. Là nhân viên, tôi muốn đính kèm chứng từ nguồn hàng nội bộ vào sản phẩm và chỉ người có quyền mới xem được qua đường dẫn có hạn, để lưu bằng chứng mà không công khai tài liệu của đối tác.
60. Là nhân viên, tôi muốn soạn và xuất bản các trang nội dung (giới thiệu, quy trình nhập hàng, các chính sách), để cập nhật mà không cần lập trình viên.

### Vận hành và SEO

61. Là chủ doanh nghiệp, tôi muốn trang sản phẩm và danh mục được máy tìm kiếm đọc tốt (render phía server, sitemap, dữ liệu cấu trúc Product), để có khách từ Google.
62. Là người vận hành, tôi muốn dữ liệu được sao lưu mỗi đêm, mã hóa và lưu ngoài máy chủ, có quy trình khôi phục đã thử trên staging, để không mất dữ liệu khi máy chủ hỏng.
63. Là người vận hành, tôi muốn lỗi ở API và website được gửi về Sentry và có kiểm tra uptime, để biết sự cố trước khi khách báo.
64. Là người vận hành, tôi muốn có môi trường staging tách DB với production, để khách duyệt từng mốc trước khi lên thật.
65. Là người vận hành, tôi muốn mỗi lần đẩy code được tự động lint, typecheck, test, build image và triển khai, để phát hành an toàn khi làm một mình.
66. Là lập trình viên tương lai của app mobile, tôi muốn cùng một API xác thực dùng được cho mobile (refresh token gửi qua body thay vì cookie), để không phải viết lại phần đăng nhập.

## Implementation Decisions

### Kiến trúc và tổ chức

- Monorepo pnpm gồm 3 phần:
  - **api**: Express + TypeScript.
  - **web**: Nuxt, chứa cả website khách và `/admin`.
  - **shared**: schema Zod, type, hằng số trạng thái. Đây là hợp đồng API dùng chung: Express dùng để kiểm tra dữ liệu vào, Nuxt dùng để định nghĩa type và kiểm tra form.
- API kiểu REST. Hai không gian `/api/*` (công khai và khách) và `/api/admin/*` (nhân viên). Mã lỗi và cấu trúc lỗi thống nhất, có lỗi kiểm tra dữ liệu theo từng trường.
- PostgreSQL + Prisma. Bật extension `unaccent` và `pg_trgm`. Các truy vấn tìm kiếm cần SQL đặc thù thì viết raw SQL qua Prisma.
- pg-boss làm hàng đợi job nền: gửi email, dọn token hết hạn. Không dùng Redis.
- Nuxt render SSR cho website, áp `routeRules` cache ngắn cho trang danh mục và trang sản phẩm. `/admin/**` đặt `ssr: false`.
- Caddy làm reverse proxy và lo HTTPS. Nuxt và API chạy cùng tên miền.

### Module xác thực (khách và nhân viên)

- Hai bảng tách biệt `customer` và `staff`. JWT của hai miền ký với **audience khác nhau**. Middleware của `/api/admin/*` chỉ chấp nhận audience staff.
- Access token sống 15 phút. Payload chỉ chứa định danh và audience, **không chứa permission**.
- Refresh token sống 30 ngày với khách, 12 giờ với nhân viên. Token lưu dạng hash trong bảng refresh token, có `family_id`.
  - Mỗi lần refresh: cấp token mới, vô hiệu token cũ (rotation).
  - Một token đã dùng mà bị dùng lại: thu hồi cả family.
  - Đổi mật khẩu, khóa tài khoản hoặc đổi role: thu hồi mọi refresh token của người đó.
- Kênh gửi token theo header `X-Client: web|mobile`:
  - **web**: refresh token nằm trong cookie httpOnly, Secure, SameSite=Strict, path chỉ là endpoint refresh. Access token trả trong body, client giữ trong bộ nhớ.
  - **mobile**: refresh token trả và nhận qua body.
- Mật khẩu băm bằng argon2id. Đăng nhập và quên mật khẩu bị giới hạn tần suất (rate limit). Thông báo lỗi không tiết lộ email có tồn tại hay không.
- Khách: có đăng ký (bắt buộc tick đồng ý chính sách dữ liệu cá nhân, lưu lại thời điểm đồng ý và phiên bản chính sách), xác minh email (không chặn việc sử dụng), quên/đặt lại mật khẩu bằng token một lần có hạn.
- Nhân viên: không có đăng ký. Owner đầu tiên tạo bằng lệnh seed hoặc CLI lúc cài đặt. Các nhân viên khác do người có quyền `staff.manage` tạo. Bảng staff để sẵn chỗ cho 2FA nhưng chưa bật.

### Module phân quyền (RBAC)

- Bốn role cố định: `owner`, `sales`, `warehouse`, `accountant`. Mỗi role là một tập permission định nghĩa trong code. Một nhân viên có thể có nhiều role.
- Permission của M0/M1: `staff.manage`, `catalog.edit`, `price.edit`, `media.upload`, `document.view`, `content.edit`, `audit.view`. Owner có tất cả. Các mốc sau thêm permission mới như `stock.adjust` hay `refund.approve`.
- Ở mỗi request, permission được tính từ role hiện tại đọc trong DB, nên thay đổi có hiệu lực ngay.
- Endpoint quản trị khai báo permission cần có. Thiếu quyền trả 403 kèm mã lỗi thống nhất.

### Module audit log

- Bảng append-only, mỗi dòng gồm: người thực hiện (staff), hành động, loại và id đối tượng, dữ liệu trước/sau (hoặc diff), IP, user agent, thời điểm.
- Bản ghi audit được ghi **trong cùng transaction** với thay đổi nghiệp vụ.
- Không có endpoint sửa hay xóa audit log. Endpoint đọc yêu cầu `audit.view`, lọc được theo người, loại đối tượng và khoảng thời gian.
- Hành động bắt buộc ghi ở mốc này: tạo/sửa/xóa staff, đổi role, khóa staff, thay đổi giá (ghi riêng hành động `price.change` gồm biến thể, giá cũ, giá mới), tạo/sửa/xuất bản/lưu trữ sản phẩm và biến thể, sửa schema thuộc tính, sửa và xuất bản trang nội dung, xem chứng từ private.

### Module danh mục

- **Thương hiệu**: tên, slug duy nhất, logo, mô tả, trạng thái hiển thị.
- **Danh mục**: dạng cây cha–con, slug duy nhất. Mỗi danh mục thuộc về một **nhóm hàng** (giày dép, quần áo, đồng hồ, túi xách, nước hoa). Schema thuộc tính gắn với nhóm hàng; danh mục con thừa hưởng schema đó.
- **Schema thuộc tính** của nhóm hàng là danh sách định nghĩa thuộc tính. Mỗi định nghĩa gồm:
  - key ổn định, nhãn tiếng Việt;
  - kiểu `enum | multi_enum | text | number | boolean`;
  - bắt buộc hay không, danh sách giá trị cho phép (với kiểu enum), đơn vị (với kiểu number);
  - cấp áp dụng `product | variant`;
  - có dùng làm bộ lọc không, thứ tự hiển thị.

  Seed sẵn schema cho 5 nhóm hàng theo bảng ở mục 3.1 của `project-overview.md`.

- Đổi schema khi đã có sản phẩm dùng nó: thêm thuộc tính không bắt buộc thì luôn được. Thêm thuộc tính bắt buộc, xóa thuộc tính hoặc bớt giá trị enum mà đang có sản phẩm vi phạm thì bị từ chối, kèm danh sách sản phẩm bị ảnh hưởng.
- **Sản phẩm**:
  - Thông tin chung: thương hiệu, danh mục, tên, slug, mã mẫu, mô tả, hướng dẫn sử dụng/bảo quản, bảng size (nội dung có cấu trúc dạng bảng).
  - **Thông tin nguồn gốc công bố** và **cam kết có bằng chứng** là hai trường tách riêng. Cam kết có bằng chứng ghi kèm loại cam kết (ví dụ "bảo hành chính hãng") và tham chiếu tới chứng từ nội bộ.
  - Thông tin bảo hành chỉ hiển thị khi có xác nhận.
  - Thuộc tính cấp sản phẩm lưu dạng JSONB, được kiểm theo schema.
  - Cờ `ground_shipping_only`. Liên kết tới các trang chính sách áp dụng.
  - Trạng thái `draft | published | archived`.
- **Biến thể**:
  - SKU duy nhất toàn hệ thống. Thuộc tính cấp biến thể lưu dạng JSONB, được kiểm theo schema, và tổ hợp này là duy nhất trong cùng sản phẩm.
  - `price` và `compare_at_price` lưu số nguyên VND, đã gồm VAT. Ràng buộc: `price > 0`; `compare_at_price` để trống hoặc `>= price`.
  - Thứ tự hiển thị, trạng thái hoạt động.
- Sản phẩm `published` phải có ít nhất một biến thể đang hoạt động và ít nhất một ảnh.
- Thay đổi `price` hoặc `compare_at_price` yêu cầu `price.edit`, tách khỏi `catalog.edit`. Người chỉ có `catalog.edit` gửi kèm thay đổi giá thì bị 403.

### Module media

- Có interface lưu trữ trừu tượng với các thao tác: đưa file lên, tạo URL công khai, tạo URL ký có hạn, xóa. Bản production dùng R2 (tương thích S3); bản test lưu trong bộ nhớ.
- Hai bucket:
  - **public**: ảnh sản phẩm, logo thương hiệu, phục vụ qua CDN.
  - **private**: chứng từ nguồn hàng. Chỉ truy cập được qua URL ký có hạn, cấp cho người có quyền `document.view`, và mỗi lần cấp đều ghi audit.
- Upload đi qua API. API kiểm tra MIME type thật từ nội dung file (không tin vào đuôi file) và giới hạn dung lượng. Ảnh nhận jpeg, png, webp; chứng từ nhận thêm pdf.
- Ảnh gắn với sản phẩm, có thứ tự, và tùy chọn gắn vào một hoặc nhiều biến thể. Có alt text.

### Module nội dung

- Trang nội dung gồm: slug, tiêu đề, nội dung rich text/markdown, loại (giới thiệu, quy trình, chính sách), trạng thái nháp/xuất bản, phiên bản.
- Mỗi lần xuất bản tạo một phiên bản mới, giữ lại phiên bản cũ. Lý do: lời đồng ý của khách và đơn hàng ở các mốc sau phải tham chiếu được đúng phiên bản chính sách tại thời điểm đó.
- Thông tin pháp lý của doanh nghiệp và ảnh logo Bộ Công Thương là cấu hình hệ thống, hiển thị ở chân trang.

### Module tìm kiếm và duyệt

- Endpoint danh sách sản phẩm công khai nhận các tham số:
  - từ khóa;
  - thương hiệu, danh mục (gồm cả danh mục con);
  - khoảng giá, so trên giá biến thể đang hoạt động;
  - các bộ lọc thuộc tính có `filterable` trong schema;
  - sắp xếp `newest | price_asc | price_desc`;
  - phân trang.

  Chỉ trả về sản phẩm `published`.

- Cách tìm từ khóa:
  - Chuẩn hóa không dấu bằng `unaccent`, dùng full-text kết hợp độ tương đồng trigram trên tên sản phẩm, tên thương hiệu và mã mẫu.
  - SKU khớp chính xác hoặc khớp tiền tố được ưu tiên lên đầu.
  - Có index tương ứng: GIN trên tsvector và trigram. Tsvector được cập nhật khi sản phẩm hoặc biến thể thay đổi.
- Kết quả trả về kèm **facets** của bộ lọc (giá trị thuộc tính có thể chọn, số lượng mỗi giá trị) theo nhóm hàng đang xem, cùng giá thấp nhất và cao nhất của sản phẩm.
- Endpoint chi tiết sản phẩm theo slug trả về: thông tin sản phẩm, schema thuộc tính dùng để hiển thị nhãn, danh sách biến thể với tổ hợp thuộc tính, giá, ảnh, và các chính sách liên kết. Chọn biến thể qua tham số SKU trên URL.

### SEO

- Trang sản phẩm và danh mục render phía server, có thẻ meta và canonical. Có sitemap sinh từ sản phẩm `published`.
- Dữ liệu cấu trúc schema.org Product/Offer gồm giá VND. `availability` chưa được khai báo cho đến khi có M2.

### Hạ tầng và vận hành

- Docker Compose cho local; staging và production chạy chung VPS nhưng tách DB và tách bucket.
- CI (GitHub Actions): lint, typecheck, test (Testcontainers), build image đẩy lên GHCR, deploy qua SSH + `docker compose pull`. Migration Prisma chạy thành một bước riêng trước khi khởi động app.
- Log JSON bằng pino, mỗi request có request id. Sentry cho cả API và Nuxt. `/healthz` kiểm tra kết nối DB; Uptime Kuma theo dõi endpoint này.
- Mỗi đêm `pg_dump`, mã hóa rồi đẩy lên một bucket R2 riêng, giữ 30 ngày. Có tài liệu quy trình khôi phục và chạy thử một lần trên staging trong mốc này.
- Interface gửi email trừu tượng: production dùng một nhà cung cấp email transactional, test dùng bản ghi vào bộ nhớ. Email gửi qua job pg-boss.

## Testing Decisions

- **Test tốt** là test chỉ kiểm hành vi nhìn thấy từ bên ngoài: gửi HTTP request rồi kiểm status, body, và các hành vi tiếp theo qua API. Không assert vào service hay repository bên trong, không assert cấu trúc bảng. Test vẫn phải xanh khi refactor bên trong.
- **Seam duy nhất** (đã thống nhất với người dùng): HTTP API của Express, gọi in-process qua supertest, chạy trên **PostgreSQL thật bằng Testcontainers** (có `unaccent` và `pg_trgm`). Hai phụ thuộc bên ngoài được thay bằng bản giả lưu trong bộ nhớ, inject qua cấu hình app:
  - lưu trữ (storage);
  - gửi email (mailer). Test đọc email đã "gửi", chẳng hạn link xác minh hoặc link đặt lại mật khẩu, từ bản giả này.
- Code phát triển theo `/tdd`, mỗi lần một lát red-green.
- Các hành vi bắt buộc có test:
  - **Xác thực:** đăng ký (cả trường hợp thiếu đồng ý thì bị từ chối), đăng nhập, refresh có rotation, dùng lại refresh token cũ thì thu hồi cả family, đổi mật khẩu thì thu hồi phiên, khóa staff thì refresh bị từ chối, cả hai kênh `web` (cookie) và `mobile` (body), giới hạn tần suất đăng nhập.
  - **Tách miền:** token khách gọi `/api/admin/*` bị 401/403.
  - **Phân quyền:** thiếu permission thì 403. Đổi role có hiệu lực ngay với access token đang còn hạn. `catalog.edit` không có `price.edit` thì không đổi được giá.
  - **Audit:** sửa giá tạo bản ghi có giá cũ và giá mới. Thao tác bị lỗi hoặc rollback thì không để lại bản ghi audit. Không có cách sửa hay xóa audit.
  - **Schema thuộc tính:** thiếu trường bắt buộc, sai kiểu, giá trị enum không hợp lệ thì trả lỗi theo trường. Đổi schema có sản phẩm vi phạm thì bị từ chối kèm danh sách sản phẩm.
  - **Biến thể:** trùng SKU, trùng tổ hợp, `compare_at_price < price` đều bị từ chối. Xuất bản sản phẩm khi chưa có biến thể hoặc chưa có ảnh bị từ chối.
  - **Tìm kiếm:** "giay" tìm ra "Giày". Tìm theo SKU thì SKU đó lên đầu. Lọc theo giá dựa trên giá biến thể. Facets đúng theo nhóm hàng. Sản phẩm draft hoặc archived không xuất hiện.
  - **Media:** sai MIME type hoặc quá dung lượng thì bị từ chối. Chứng từ private chỉ lấy được URL ký khi có `document.view`, và mỗi lần lấy đều ghi audit.
  - **Nội dung:** xuất bản tạo phiên bản mới, phiên bản cũ vẫn đọc được.
- Mỗi test có DB sạch: dùng một container cho cả lượt chạy, mỗi test chạy trong schema riêng hoặc được truncate trước khi chạy. Dữ liệu dựng bằng builder hoặc factory qua chính API, hoặc seed tối thiểu.
- Chưa có tiền lệ test nào trong repo vì đây là dự án mới; các test của spec này sẽ là tiền lệ cho các mốc sau.
- Chưa test Nuxt hay E2E trong mốc này. Playwright bắt đầu từ M3, với luồng mua hàng.

## Out of Scope

- Tồn kho, sổ xuất nhập kho, tình trạng còn hàng/hết hàng/đặt trước trên trang sản phẩm (M2, M4).
- Import sản phẩm, biến thể và tồn đầu kỳ bằng CSV/Excel, tải ảnh hàng loạt ghép theo SKU (cuối M2).
- Giỏ hàng, checkout, giữ hàng, thanh toán PayOS, báo giá vận chuyển, địa chỉ hai cấp tỉnh/xã (M3).
- Đặt trước, đặt cọc, đợt đặt trước (M4). Voucher (M5). Hủy đơn, hoàn tiền, đổi trả, bảo hành, ticket hỗ trợ (M6). Báo cáo (M7). Chatbot (M8).
- Tra cứu đơn cho khách không có tài khoản qua OTP email (M3).
- Yêu cầu xóa dữ liệu cá nhân của khách (ghi nhận ở mốc hậu mãi).
- 2FA cho nhân viên, owner tự tạo role, Zalo ZNS, đăng nhập Google.
- Sale tự động theo thương hiệu hoặc danh mục. Đánh giá sản phẩm, danh sách yêu thích (giai đoạn 2).

## Further Notes

- Thư mục dự án **chưa phải git repo** và chưa có remote. Bước CI/CD cần một repo GitHub (dùng cho Actions và GHCR), dù ticket vẫn lưu dạng local markdown. Cần `git init` và tạo remote trước ticket hạ tầng.
- Chưa có `GLOSSARY.md` hay ADR. Các thuật ngữ dùng trong spec này nên được đưa vào glossary qua `/domain-modeling`: nhóm hàng, schema thuộc tính, biến thể, SKU, giá gốc/giá bán, thông tin công bố và cam kết có bằng chứng, chứng từ, trang nội dung, phiên bản chính sách. Các quyết định khó đảo ngược nên ghi thành ADR: Express + Nuxt monorepo, JWT rotation hai miền, permission đọc từ DB mỗi request, audit log append-only cùng transaction.
- Đã chốt (2026-10-21) cách xử lý ảnh khi upload: sinh sẵn các cỡ ảnh webp bằng sharp ngay lúc upload, giữ cả bản gốc. Không phụ thuộc tính năng biến đổi ảnh có tính phí của CDN.
- Các nội dung do chủ doanh nghiệp cung cấp vẫn còn mở: chính sách nguồn gốc và bảo hành, nội dung các trang chính sách, thông tin pháp lý và việc thông báo website với Bộ Công Thương. Hệ thống chỉ cung cấp chỗ soạn và hiển thị, không tự điền nội dung.
- Lựa chọn nhà cung cấp email transactional (Resend, SES, SMTP) nằm sau interface mailer và có thể chốt khi làm ticket email.
