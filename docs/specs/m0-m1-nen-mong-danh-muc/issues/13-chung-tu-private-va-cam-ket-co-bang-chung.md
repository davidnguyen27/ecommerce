# 13: Chứng từ private và cam kết có bằng chứng

**What to build:**
- Nhân viên đính kèm chứng từ nguồn hàng nội bộ (hóa đơn nhập, giấy tờ của nhà cung cấp) vào sản phẩm. Chứng từ không bao giờ công khai.
- Chỉ người có quyền `document.view` mới mở được chứng từ, qua một đường dẫn có hạn. Mỗi lần mở đều được ghi lại.
- Người có quyền `commitment.edit` (permission mới, mặc định chỉ owner) ghi **cam kết có bằng chứng** cho sản phẩm (ví dụ "bảo hành chính hãng"), tham chiếu tới chứng từ đã đính kèm, và quản lý danh sách **loại cam kết**.
- Bảo hành chỉ hiển thị cho khách dưới dạng cam kết có bằng chứng thuộc loại bảo hành; sản phẩm không có trường bảo hành riêng (ADR 0005).
- Trang chi tiết sản phẩm hiển thị cam kết có bằng chứng tách biệt khỏi thông tin công bố thông thường, để khách biết mức độ tin cậy. Nội dung chứng từ không bị lộ ra.

**Blocked by:** 10 (Ảnh sản phẩm và logo thương hiệu)

**Status:** resolved

- [x] Chứng từ lưu trong bucket private qua interface storage của ticket 10. Nhận pdf, jpeg, png, webp; kiểm MIME type thật và giới hạn dung lượng
- [x] Không có URL công khai nào cho chứng từ. Người có `document.view` lấy được URL ký có hạn; thiếu quyền thì 403
- [x] Mỗi lần cấp URL ký đều ghi audit (ai mở, chứng từ nào, lúc nào)
- [x] Thêm permission `commitment.edit` vào danh sách permission dùng chung; chỉ owner có theo mặc định
- [x] Loại cam kết là danh sách đóng, seed sẵn (ít nhất: Bảo hành chính hãng, Bảo hành quốc tế, Có hóa đơn nhập khẩu); chạy seed lại không tạo trùng. Thêm, sửa loại cam kết yêu cầu `commitment.edit` và ghi audit
- [x] Cam kết có bằng chứng gắn ở cấp sản phẩm, gồm một loại cam kết trong danh sách, nội dung hiển thị cho khách và tham chiếu tới một hoặc nhiều chứng từ của chính sản phẩm đó. Không tạo được cam kết khi không có chứng từ. Tạo, sửa, gỡ cam kết yêu cầu `commitment.edit` và ghi audit
- [x] Không xóa được chứng từ đang được cam kết tham chiếu; lỗi kèm danh sách các cam kết đó
- [x] API công khai của trang chi tiết sản phẩm trả về cam kết có bằng chứng (loại và nội dung hiển thị), không trả về chứng từ hay URL của chứng từ
- [x] Trình soạn sản phẩm trong admin có mục chứng từ (tải lên, xem qua URL ký) và mục cam kết. Trang chi tiết sản phẩm hiển thị cam kết có bằng chứng có nhãn phân biệt _(trang chi tiết sản phẩm gắn ở ticket 11)_
- [x] Có test qua HTTP với storage giả cho các trường hợp:
  - thiếu `document.view` thì không lấy được URL;
  - mỗi lần lấy URL đều ghi audit;
  - API công khai không chứa chứng từ;
  - cam kết không có chứng từ bị từ chối;
  - có `catalog.edit` nhưng không có `commitment.edit` thì bị 403 khi tạo cam kết;
  - cam kết với loại không có trong danh sách bị từ chối;
  - xóa chứng từ đang được tham chiếu bị từ chối;
  - sản phẩm không có cam kết bảo hành thì API công khai không trả về bảo hành nào

**Quyết định khi triển khai (2026-10-23):**
- Lưu trữ: migration `20261025001300_documents_commitments`. Bảng `product_document` (file ở bucket private, key `products/<productId>/documents/<id>`, `file_name`, `content_type` thật, `size_bytes`), `commitment_type` (`name` duy nhất, `kind` enum `warranty | other`), `product_commitment` (`product_id`, `type_id`, `statement`; unique `(product_id, type_id)`: mỗi loại tối đa một cam kết trên một sản phẩm), `product_commitment_document` (FK tới chứng từ `ON DELETE RESTRICT` làm chốt chặn cuối). Seed 3 loại (Bảo hành chính hãng, Bảo hành quốc tế: `warranty`; Có hóa đơn nhập khẩu: `other`) ngay trong migration với `ON CONFLICT ("name") DO NOTHING`, theo cách ticket 08 seed schema thuộc tính.
- "Loại bảo hành" được xác định bằng `kind = 'warranty'` của loại cam kết, không dựa vào tên. Không có xóa loại cam kết (chỉ thêm, sửa) để cam kết đã ghi luôn trỏ tới loại còn tồn tại.
- Upload: `api/src/media/upload.ts` tách khung multer của ticket 10 (`receiveFile(maxBytes, msg)`, `requiredFile`, `fileError`; thêm `defParamCharset: 'utf8'` để giữ tên file tiếng Việt). `api/src/media/documents.ts` kiểm loại thật bằng chữ ký đầu file (`%PDF-`, JPEG, PNG, RIFF/WEBP); sai thì 400 trên `file`. Giới hạn `MAX_DOCUMENT_BYTES` = 20 MB (413). URL ký sống `DOCUMENT_URL_TTL_SECONDS` = 300 giây.
- API admin (schema shared trong `shared/src/commitments.ts`):
  - `GET|POST /api/admin/products/:id/documents` (`AdminProductDocumentList`, multipart `file` → 201 `AdminProductDocument`), `POST …/documents/:documentId/url` → `DocumentUrl { url, expiresAt }` (POST vì mỗi lần cấp ghi audit), `DELETE …/documents/:documentId` (204; đang được cam kết tham chiếu thì 409 `CONFLICT`, `fields` gồm `{ path: 'commitments.<id>', message: '<tên loại>: <nội dung>' }` cho từng cam kết).
  - `GET /api/admin/commitment-types` (`CommitmentTypeList`, xếp theo tên), `POST` (201), `PUT /:id`; trùng tên 409 trên `name`.
  - `GET|POST /api/admin/products/:id/commitments`, `PUT|DELETE …/commitments/:commitmentId`. Body `CommitmentRequest { typeId, statement, documentIds (≥1) }`; trả `AdminCommitment { id, typeId, typeName, kind, statement, documentIds }`. Không có chứng từ thì 400 trên `documentIds`; chứng từ của sản phẩm khác 400 trên `documentIds.N`; loại không có trong danh sách 400 trên `typeId`; trùng loại 409 trên `typeId`.
- API công khai: hàm `publicCommitments(db, productId): Promise<PublicCommitment[]>` trong `api/src/catalog/commitments.ts`, trả `{ type, kind, statement }[]` (không bao giờ có chứng từ hay URL), xếp theo tên loại. Ticket 11 gộp vào `GET /api/products/:slug` thành trường `commitments` và bỏ route tạm `GET /api/products/:slug/commitments` cùng `PublicCommitmentList`. Bảo hành với khách = các phần tử `kind === 'warranty'`; không có thì không hiện bảo hành nào.
- Web: `ProductDocuments` (tải lên, mở qua URL ký ở tab mới, xóa; chỉ hiện khi có `document.view`) và `ProductCommitments` trong `/admin/products/:id`; trang `/admin/commitment-types` (menu "Loại cam kết", cần `commitment.edit`). Component khách `EvidencedCommitments` (prop `commitments: PublicCommitment[]`, khung "Cam kết có chứng từ" với nhãn "Bảo hành"/"Đã xác minh", không hiện gì khi rỗng) để ticket 11 đặt tách khỏi thông tin nguồn gốc công bố. Chưa trang khách nào dùng nên `scripts/smoke.ts` không đổi.
- Quyền: thêm `commitment.edit` vào `Permission` (chỉ owner có, vì owner có tất cả). Dùng `document.view` cho mọi thao tác chứng từ (xem danh sách, tải lên, lấy URL ký, xóa): chứng từ là tài liệu của đối tác, nên người không được xem cũng không tải lên hay xóa; kế toán (không có `media.upload`) vẫn tải được hóa đơn nhập. Xem danh sách cam kết và loại cam kết: `catalog.edit`, `price.edit`, `document.view` hoặc `commitment.edit`. Ghi cam kết, loại cam kết: `commitment.edit`.
- Audit: `document.upload|delete` và `document.view` (mỗi lần cấp URL ký; `entityType: 'product_document'`, `after: { productId, fileName, expiresAt }`, người mở là actor); `commitment_type.create|update` (`{ name, kind }`); `commitment.create|update|delete` (`entityType: 'product_commitment'`, `{ productId, typeId, statement, documentIds }`). Ghi cam kết và xóa chứng từ cùng khóa dòng sản phẩm `FOR UPDATE`. Lưu không đổi gì thì không ghi.
- Còn mở: cam kết không đi qua bản nháp/snapshot xuất bản của ticket 11: owner sửa là khách thấy ngay (cam kết đã có quyền riêng và chứng từ làm căn cứ). **Cần chủ doanh nghiệp xác nhận** điều này, hoặc ticket 11 chép cam kết vào snapshot lúc xuất bản. Chưa test URL ký của `R2Storage` với R2 thật.
- Sau code review (2026-10-24): đã quyết: cam kết đi theo bản xuất bản (ticket 11 chép vào snapshot), sửa cam kết chỉ hiện với khách khi xuất bản lại. Quyền tải chứng từ giữ `document.view` (ticket không nêu quyền riêng). Nhãn loại cam kết dùng chung `web/app/utils/commitmentKind.ts`.
