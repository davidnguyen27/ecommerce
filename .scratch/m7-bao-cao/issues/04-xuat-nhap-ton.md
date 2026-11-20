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

**Status:** ready-for-agent

- [ ] `GET /api/admin/reports/stock` theo spec mục "Xuất nhập tồn":
  - tồn đầu/tồn cuối lấy từ `on_hand_after` của dòng sổ cuối cùng (theo `seq`) trước kỳ / tới hết kỳ;
  - biến động lấy theo `kind`.

  Truy vấn SQL dùng index `(variant_id, seq)` và `created_at`.
- [ ] Web: tab Xuất nhập tồn với bộ lọc, bảng và phân trang.
- [ ] Test:
  - bất biến tồn đầu + biến động = tồn cuối, với đủ `opening`, `receipt`, `sale`, `return`, `adjustment` ±;
  - biến thể không biến động trong kỳ vẫn hiện, trừ khi bật lọc;
  - biến thể chưa có dòng sổ nào tới hết kỳ không hiện;
  - lọc nhóm hàng, thương hiệu;
  - dòng tổng.

Spec: "Xuất nhập tồn". GLOSSARY: "Tồn đầu"/"Tồn cuối" khác "Tồn đầu kỳ".
