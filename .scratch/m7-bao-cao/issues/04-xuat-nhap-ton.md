# 04: Báo cáo xuất nhập tồn

**What to build:** Tab Xuất nhập tồn. Mỗi biến thể có các cột:
- tồn đầu;
- nhập (phiếu nhập + tồn đầu kỳ);
- xuất bán;
- hàng hoàn về;
- điều chỉnh tăng, điều chỉnh giảm;
- tồn cuối.

Lọc được theo nhóm hàng, thương hiệu, "chỉ biến thể có biến động". Phân trang 100 dòng, có dòng tổng.

**Blocked by:** 01

**Status:** resolved

- [x] `GET /api/admin/reports/stock` theo spec mục "Xuất nhập tồn":
  - tồn đầu/tồn cuối lấy từ `on_hand_after` của dòng sổ cuối cùng (theo `seq`) trước kỳ / tới hết kỳ;
  - biến động lấy theo `kind`.

  Truy vấn SQL dùng index `(variant_id, seq)` và `created_at`.
- [x] Web: tab Xuất nhập tồn với bộ lọc, bảng và phân trang.
- [x] Test:
  - bất biến tồn đầu + biến động = tồn cuối, với đủ `opening`, `receipt`, `sale`, `return`, `adjustment` ±;
  - biến thể không biến động trong kỳ vẫn hiện, trừ khi bật lọc;
  - biến thể chưa có dòng sổ nào tới hết kỳ không hiện;
  - lọc nhóm hàng, thương hiệu;
  - dòng tổng.

Spec: "Xuất nhập tồn". GLOSSARY: "Tồn đầu"/"Tồn cuối" khác "Tồn đầu kỳ".

## Quyết định khi triển khai

- **API:** `GET /api/admin/reports/stock?from&to&productType&brandId&movedOnly&page`, query `StockReportQuery`. Kỳ dùng chung phần kiểm với `ReportQuery`; zod không cho `extend` một schema đã refine, nên phần kiểm kỳ được tách thành `checkPeriod`. `groupBy` bị bỏ qua.
- **Một CTE theo biến thể:**
  - tồn đầu/tồn cuối là subquery `on_hand_after` của dòng sổ cuối cùng (`ORDER BY seq DESC`), có `created_at` trước đầu kỳ / trước hết kỳ;
  - biến động trong kỳ là `sum(...) FILTER` theo loại.

  Hai truy vấn dùng chung CTE: một lấy trang (100 dòng, sắp theo SKU), một lấy số dòng và dòng tổng của toàn bộ kết quả lọc.
- **Danh sách thương hiệu cho bộ lọc:** response có thêm `brands` (thương hiệu có biến thể trong sổ). Lý do: kế toán không có `catalog.edit` nên không đọc được `/api/admin/brands`.
- SKU link tới sổ xuất nhập của biến thể khi người xem mở được trang đó (`canOpen`). Kế toán không có quyền xem kho nên chỉ thấy chữ.
- **Test** dời dòng sổ về trước kỳ bằng `backdateStock` (`test/support/backdate.ts`). Bất biến được kiểm với phiếu nhập, xuất bán, hàng hoàn về của trả hàng, và điều chỉnh tăng lẫn giảm. Loại `opening` có test riêng: dựng dòng sổ bằng Prisma, vì loại này chỉ sinh ra qua import Excel.
