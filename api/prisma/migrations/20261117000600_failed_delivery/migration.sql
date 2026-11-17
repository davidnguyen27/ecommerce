-- Giao thất bại (M6a): kho ghi nhận hàng hoàn về, đơn sang trạng thái giao hàng `returned`; phần nhập lại tồn ghi sổ loại
-- `return` trỏ về đơn.

-- AlterEnum
ALTER TYPE "fulfillment_status" ADD VALUE 'returned';

-- AlterEnum
ALTER TYPE "stock_movement_kind" ADD VALUE 'return';

-- Dòng sổ xuất bán và hàng hoàn về luôn trỏ về đơn, loại khác thì không. So theo text vì giá trị enum vừa thêm chưa dùng
-- được trong cùng transaction.
ALTER TABLE "stock_movement" DROP CONSTRAINT "stock_movement_order_check";
ALTER TABLE "stock_movement" ADD CONSTRAINT "stock_movement_order_check"
  CHECK (("kind"::text IN ('sale', 'return')) = ("order_id" IS NOT NULL));

-- Kết quả lần nhận hàng hoàn về gần nhất của dòng: số nhập lại tồn và số hỏng/mất (không ghi sổ vì hàng đã rời tồn lúc
-- bàn giao). Giao lại từ kho đưa hai số về 0; lịch sử nằm ở sự kiện đơn và sổ xuất nhập.
ALTER TABLE "order_line" ADD COLUMN "returned_quantity" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "written_off_quantity" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "order_line" ADD CONSTRAINT "order_line_return_check" CHECK (
    "returned_quantity" >= 0 AND "written_off_quantity" >= 0
    AND "returned_quantity" + "written_off_quantity" <= "quantity"
);

-- `order_handover_check` không đổi: `returned` không thuộc nhóm đã bàn giao, nên đơn vị vận chuyển, mã vận đơn và lúc
-- bàn giao phải trống, đúng với việc nhận hàng hoàn về xóa ba trường này.
