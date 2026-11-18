-- Bảo hành (spec M6b ticket 06): các mốc nhận hàng của khách → gửi hãng hay sửa → trả lại khách (đơn vị vận chuyển, mã
-- vận đơn), và kết quả. Không mốc nào đụng tới tồn. Kết quả "đổi mới" tạo yêu cầu đổi cùng biến thể, nên dòng đổi được
-- phép trùng biến thể đang giữ (khách tự đổi vẫn bị API chặn).

CREATE TYPE "warranty_outcome" AS ENUM ('repaired', 'replaced', 'rejected', 'refunded');

ALTER TABLE "support_request" ADD COLUMN "warranty_received_at" TIMESTAMP(3),
ADD COLUMN "warranty_sent_at" TIMESTAMP(3),
ADD COLUMN "warranty_returned_at" TIMESTAMP(3),
ADD COLUMN "warranty_return_carrier" TEXT,
ADD COLUMN "warranty_return_tracking_number" TEXT,
ADD COLUMN "warranty_outcome" "warranty_outcome",
ADD COLUMN "warranty_outcome_note" TEXT;

-- Mốc theo thứ tự; trả lại khách có đủ đơn vị vận chuyển và mã vận đơn; sửa xong cần đã trả lại khách; từ chối cần lý do;
-- đổi mới hay hoàn tiền cần đã nhận hàng; chỉ yêu cầu bảo hành có các cột này.
ALTER TABLE "support_request" ADD CONSTRAINT "support_request_warranty_check" CHECK (
    ("warranty_sent_at" IS NULL OR "warranty_received_at" IS NOT NULL)
    AND ("warranty_returned_at" IS NULL OR "warranty_sent_at" IS NOT NULL)
    AND ("warranty_returned_at" IS NULL) = ("warranty_return_carrier" IS NULL)
    AND ("warranty_returned_at" IS NULL) = ("warranty_return_tracking_number" IS NULL)
    AND ("warranty_outcome" IS NULL OR "warranty_outcome"::text <> 'repaired' OR "warranty_returned_at" IS NOT NULL)
    AND ("warranty_outcome" IS NULL OR "warranty_outcome"::text <> 'rejected' OR "warranty_outcome_note" IS NOT NULL)
    AND ("warranty_outcome" IS NULL OR "warranty_outcome"::text NOT IN ('replaced', 'refunded')
        OR "warranty_received_at" IS NOT NULL)
    AND ("warranty_outcome_note" IS NULL OR "warranty_outcome" IS NOT NULL)
    AND (("warranty_received_at" IS NULL AND "warranty_outcome" IS NULL) OR "kind" = 'warranty')
);

ALTER TABLE "support_request_line" DROP CONSTRAINT "support_request_line_exchange_check";
ALTER TABLE "support_request_line" ADD CONSTRAINT "support_request_line_exchange_check" CHECK (
    "reserved_quantity" BETWEEN 0 AND "quantity"
    AND ("exchange_variant_id" IS NOT NULL OR "reserved_quantity" = 0)
);
