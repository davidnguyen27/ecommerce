-- Nguồn ghi nhận mới: tham số có chữ ký VNPAY gửi kèm khi đưa khách về trang kết quả (ADR 0010).
ALTER TYPE "payment_source" ADD VALUE 'return';
