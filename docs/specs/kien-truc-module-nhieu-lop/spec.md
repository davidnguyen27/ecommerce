# Spec: Backend theo module nhiều lớp

**Status:** ready-for-agent

Nguồn: review repo [TamokiLoi/ecommerce-franchise-training-nodejs](https://github.com/TamokiLoi/ecommerce-franchise-training-nodejs) ngày 2026-11-28; chủ dự án chọn áp dụng nguyên khuôn của repo đó. Quyết định ghi ở ADR 0018. Đây là refactor lớn: không đổi hợp đồng HTTP, không có migration. Spec này thay thế spec `chuyen-route-vao-thu-muc-mien` (đã bỏ cùng nhánh, chưa merge).

## Problem Statement

`api/src` không có khuôn chung cho các miền:
- Router nằm riêng trong `routes/` (42 file, khoảng 5.000 dòng), tách khỏi thư mục miền.
- Mỗi thư mục miền tổ chức một kiểu: `orders/` theo việc (`cancel-order.ts`, `fulfill-order.ts`), `catalog/` theo đối tượng, `payments/` lẫn cả adapter cổng thanh toán.
- Không có ranh giới giữa các module: module này import thẳng hàm nội bộ của module kia.

Người mới không đoán được một chức năng nằm ở file nào. Thêm một miền mới thì không có mẫu để làm theo.

## Solution

### Cấu trúc thư mục

```
api/src/
├── app.ts                    # createApp(deps): lắp module, gắn route (chữ ký giữ nguyên cho test)
├── server.ts
├── core/
│   ├── module/base.module.ts         # BaseModule, IRoute
│   ├── controller/base-crud.controller.ts
│   ├── service/base-crud.service.ts
│   ├── repository/base.repository.ts
│   ├── middleware/                   # validate, require-auth, staff-context (quyền), error, rate-limit
│   ├── context/request-context.ts    # RequestContext: người thao tác, ip, user agent
│   ├── audit/audited.ts              # audited(db, ctx, fn): nhận ctx thay cho req
│   ├── db.ts, errors.ts, pagination.ts
│   ├── adapters/                     # llm, mailer, storage (giữ nguyên)
│   ├── jobs/                         # pg-boss
│   └── media/                        # upload, xử lý ảnh, PDF
├── modules/
│   ├── index.ts                      # createModules(deps): khởi tạo theo thứ tự phụ thuộc
│   └── <module>/
│       ├── <module>.module.ts        # lắp ráp: repository → service → controller → route
│       ├── <module>.route.ts         # đường dẫn, quyền, validate
│       ├── <module>.controller.ts    # đọc dto đã validate + ctx, gọi service, trả response
│       ├── <module>.service.ts       # nghiệp vụ; mở transaction; ghi audit trong transaction
│       ├── <module>.repository.ts    # truy vấn Prisma/SQL; luôn nhận db
│       ├── <module>.mapper.ts        # bản ghi Prisma → kiểu response trong shared
│       ├── <module>.interface.ts     # I<Module>Query: phần module khác được gọi
│       ├── dto/                      # export lại schema zod từ @ecommerce/shared
│       └── index.ts                  # chỉ export Module và interface
└── generated/prisma/
api/plop-templates/  +  api/plopfile.js     # `pnpm --filter api gen:module`
```

### Hình dạng các lớp

```ts
// core/module/base.module.ts
export interface IRoute { path: string; router: Router }
export abstract class BaseModule { abstract readonly routes: IRoute[] }

// core/repository/base.repository.ts: mọi method nhận db (tx hoặc client), không có db mặc định
export abstract class BaseRepository<Row, Create, Update> {
  findById(db: DbClient, id: string): Promise<Row | null>
  lockById(db: Prisma.TransactionClient, id: string): Promise<Row | null>   // SELECT … FOR UPDATE
  create(db: DbClient, data: Create): Promise<Row>
  update(db: DbClient, id: string, data: Update): Promise<Row>
}

// core/service/base-crud.service.ts: hook như repo tham chiếu, nhưng chạy trong một transaction có audit
export abstract class BaseCrudService<Row, Create, Update> {
  create(input: Create, ctx: RequestContext): Promise<Row>   // audited(db, ctx, tx => beforeCreate → create → audit)
  update(id: string, input: Update, ctx: RequestContext): Promise<Row>  // lockById → beforeUpdate → không đổi gì thì không ghi
  protected beforeCreate?(tx, input): Promise<void>
  protected beforeUpdate?(tx, current: Row, input): Promise<Update | null>  // null = không đổi
  protected abstract auditOf(row: Row): AuditSnapshot
}

// <module>.route.ts
this.router.post('/', requirePermission('catalog.edit'), validate(CreateCategoryDto), this.controller.create)

// <module>.controller.ts: không try/catch (Express 5)
create = async (req: Request, res: Response) => {
  const body: AdminCategory = toAdminCategory(await this.service.create(dtoOf(res), contextOf(req)))
  res.status(201).json(body)
}
```

### Quy tắc

1. **Transaction do service mở.** Repository không bao giờ tự mở transaction. Khi service gọi sang module khác trong một transaction, nó truyền `tx` qua interface của module đó; tham số `tx` là bắt buộc.
2. **Audit trong transaction** (ADR 0003): qua `audited(db, ctx, fn)`. Không ghi audit sau commit.
3. **Chuyển trạng thái phải khóa dòng:** `lockById` (`FOR UPDATE`) rồi mới kiểm, hoặc `updateMany` kèm điều kiện trạng thái nguồn. Không đọc rồi ghi khi không có khóa.
4. **Module chỉ import từ `modules/<khác>/index.ts`**, tức là `Module` và `I…Query` của module đó, không import file bên trong. ESLint chặn bằng `no-restricted-imports`.
5. **Quyền khai ở route:** `requirePermission(...)` (ADR 0002). Quyền sở hữu (đơn của khách, token tra cứu) kiểm ở service.
6. **DTO:** `dto/*.dto.ts` export lại schema zod từ `@ecommerce/shared` (ví dụ `export { CreateCategoryRequest as CreateCategoryDto }`). Middleware `validate(Schema, 'body' | 'query')` parse một lần; controller đọc kết quả qua `dtoOf(res)`.
7. **Lỗi:** dùng `AppError` và `ErrorCode` như hiện nay; không tìm thấy là 404.
8. **Hợp đồng HTTP giữ nguyên:** đường dẫn, status, body, header (`Cache-Control`, `Retry-After`).

### Bảng module

| Module | Lấy từ (hiện tại) |
|---|---|
| `auth` | `routes/admin-auth.ts`, `auth/session-routes.ts`, `auth/refresh-tokens.ts`, `access-token.ts`, `password.ts` |
| `staff` | `routes/admin-staff.ts`, `auth/staff.ts` |
| `customer-auth` | `routes/customer-auth.ts`, `customers/*` |
| `customer` | `routes/account.ts` |
| `audit-log` | `routes/admin-audit.ts` |
| `category` | `routes/admin-categories.ts`, phần danh mục của `routes/public-catalog.ts`, `catalog/categories.ts` |
| `brand` | `routes/admin-brands.ts`, phần thương hiệu của `routes/public-catalog.ts` |
| `attribute-schema` | `routes/admin-attribute-schemas.ts`, phần schema của `routes/public-catalog.ts`, `catalog/attribute-schemas.ts` |
| `commitment-type` | `routes/admin-commitment-types.ts` |
| `product` | `routes/admin-products.ts`, `admin-product-publishing.ts`, `admin-product-images.ts`, `admin-product-documents.ts`, `admin-product-commitments.ts`, `public-products.ts`; `catalog/products.ts`, `variants.ts`, `publication.ts`, `search.ts`, `live-variants.ts`, `public-products.ts`, `commitments.ts` |
| `product-import` | `routes/admin-import.ts`, `catalog/import.ts` |
| `stock` | `routes/admin-stock.ts`, `stock/stock.ts` |
| `stock-receipt` | `routes/admin-stock-receipts.ts` |
| `order` | `routes/admin-orders.ts`, `account-orders.ts`, `public-orders.ts`, `orders/*` |
| `checkout` | `routes/checkout.ts`, `routes/preorders.ts`, `placement/*` |
| `preorder-campaign` | `routes/admin-preorder-campaigns.ts`, `preorders/*` |
| `payment` | `routes/payments.ts`, `payments/gateway*.ts`, `vnpay.ts`, `record-payment.ts`, `payment-link.ts` |
| `reconciliation` | `routes/admin-reconciliation.ts`, `payments/reconciliation.ts` |
| `refund` | `routes/admin-refunds.ts`, `payments/refunds.ts`, `gateway-refund.ts` |
| `voucher` | `routes/admin-vouchers.ts`, `vouchers/*` |
| `shipping-fee` | `routes/admin-shipping-fees.ts`, `shipping/*` |
| `support` | `routes/admin-support.ts`, `routes/support-customer.ts`, `support/*` |
| `return-window` | `routes/admin-return-windows.ts` |
| `content-page` | `routes/admin-pages.ts`, `routes/public-pages.ts`, `content/pages.ts` |
| `legal-info` | `routes/legal-info.ts` |
| `sitemap` | `routes/public-sitemap.ts` |
| `report` | `routes/admin-reports.ts`, `reports/*` |
| `chatbot` | `routes/chat.ts`, `routes/admin-chatbot.ts`, `chat/*` |
| `health` | `routes/health.ts` |

Cổng thanh toán (`PaymentGateway`, `VnpayGateway`) là adapter, nằm ở `core/adapters/payment/`. Module `payment`, `refund`, `order` nhận nó qua `deps`.

## Implementation Decisions

- **Làm dần từng module.** Trong lúc chuyển, `app.ts` gắn cả route cũ lẫn module mới; mỗi ticket chuyển hẳn một nhóm route và xóa code cũ của nhóm đó. Không có ticket nào để hai bản cùng xử lý một đường dẫn.
- **Hai module mẫu đi trước.** `category` (CRUD qua `BaseCrudService`) và `order` (nghiệp vụ có khóa, gọi sang module khác) chốt khuôn. Sửa khuôn sau hai module này thì sửa cả generator.
- **Logic giữ nguyên từng chữ:** thông điệp lỗi, `fields`, nội dung audit, thứ tự khóa (email → phone → biến thể → voucher), giới hạn tần suất.
- **Code chuyển, không viết lại từ đầu.** Thân hàm nghiệp vụ hiện có chuyển thành method của service; câu SQL/Prisma chuyển thành method của repository; hàm `to…` chuyển vào mapper.
- `createApp(deps)` giữ nguyên chữ ký, để `test/support/test-app.ts` không đổi.
- Comment tiếng Anh, ngắn (CODING_STANDARDS).

## Testing Decisions

- Bộ test HTTP (84 file) là lưới an toàn. Mọi ticket phải xanh mà không sửa test. Phải sửa test là dấu hiệu hành vi đã đổi.
- Không thêm test gọi thẳng service hay repository (CODING_STANDARDS: có đường HTTP thì đi HTTP).
- Mỗi ticket chạy `pnpm typecheck`, `pnpm lint`, bộ test api trên CI (máy dev không có Docker) và `pnpm smoke`.

## Out of Scope

- Đổi hợp đồng HTTP: bọc response trong `{ data }` như repo tham chiếu, đổi status, đổi đường dẫn.
- Đổi ORM hay DB, đổi job queue.
- Web (`web/`) và `shared/`: chỉ dùng lại schema có sẵn.
- Swagger: repo tham chiếu có, nhưng là tính năng mới; làm riêng nếu cần.

## Further Notes

- Ticket: 01 lớp nền và generator → 02 `category`, 03 `order` (song song được) → 04–09 theo nhóm module (song song được sau khi 02 và 03 xong) → 10 dọn dẹp.
- Làm trên nhánh riêng cho từng ticket hoặc từng nhóm, mỗi nhóm một PR, để review được. Khi đang chuyển thì không mở nhánh tính năng mới chạm vào `api/src`.
