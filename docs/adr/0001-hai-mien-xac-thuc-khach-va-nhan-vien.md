# Khách và nhân viên là hai miền xác thực tách biệt

Khách và nhân viên nằm ở hai bảng riêng (`customer`, `staff`), JWT của mỗi miền ký với audience riêng, và `/api/admin/*` chỉ nhận audience staff. Chúng tôi không dùng chung một bảng `user` có cờ vai trò, vì một lỗi phân quyền ở miền khách khi đó có thể mở đường vào trang quản trị, và hai miền có vòng đời khác nhau: khách tự đăng ký, sống phiên 30 ngày; nhân viên do người khác tạo, sống phiên 12 giờ. Refresh token có rotation theo family để phát hiện token bị đánh cắp và dùng lại.

## Consequences

Một người vừa là nhân viên vừa mua hàng sẽ có hai tài khoản độc lập, có thể trùng email.
