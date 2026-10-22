# Audit log chỉ ghi thêm và ghi trong cùng transaction với thay đổi nghiệp vụ

Mỗi thay đổi cần audit (giá, nhân viên, sản phẩm, xem chứng từ...) ghi bản audit trong cùng transaction DB với chính thay đổi đó, và không có đường nào để sửa hay xóa audit. Chúng tôi không ghi audit bất đồng bộ (qua hàng đợi hoặc event) vì như thế có thể xảy ra thay đổi thành công mà mất dấu vết, hoặc có dấu vết cho thay đổi đã bị rollback; đổi lại, mọi service ghi nghiệp vụ phải nhận transaction và gọi audit bên trong nó.
