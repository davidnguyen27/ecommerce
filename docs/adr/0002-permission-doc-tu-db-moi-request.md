# Permission được tính lại từ DB ở mỗi request, không nằm trong JWT

Access token chỉ chứa định danh và audience; permission của nhân viên được tính từ role hiện tại đọc trong DB ở mỗi request quản trị. Chúng tôi chấp nhận thêm một truy vấn mỗi request để việc khóa nhân viên hoặc đổi role có hiệu lực ngay, thay vì phải chờ access token (15 phút) hết hạn. Đừng "tối ưu" bằng cách nhét permission vào token.
