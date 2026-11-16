-- M4 ticket 05: đơn đặt trước đã nhận cọc (GLOSSARY "Tiền cọc"). Đã cọc không có nghĩa là đã trả đủ.
-- Giá trị enum mới chưa dùng được trong cùng transaction, nên check constraint dùng nó nằm ở migration sau.
ALTER TYPE "payment_status" ADD VALUE 'deposit_paid' BEFORE 'paid';
