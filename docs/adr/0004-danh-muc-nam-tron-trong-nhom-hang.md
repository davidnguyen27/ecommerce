# Danh mục nằm trọn trong một nhóm hàng; giới tính là thuộc tính, không phải nhánh cây

Gốc cây danh mục là năm nhóm hàng cố định, và mọi danh mục con phải cùng nhóm hàng với cha, vì nhóm hàng quyết định schema thuộc tính và bộ lọc của mọi sản phẩm bên dưới. Vì vậy cây không có danh mục "Nam", "Nữ" hay "Sale" trải qua nhiều nhóm hàng: giới tính là thuộc tính cấp sản phẩm (Nam / Nữ / Unisex) có trong schema của mọi nhóm hàng, và menu Nam/Nữ là trang tìm kiếm có lọc giới tính (Unisex hiện ở cả hai). Nhu cầu gom hàng nhiều nhóm sẽ được đáp ứng sau bằng Bộ sưu tập, một khái niệm tách khỏi cây danh mục.

## Considered Options

- Gắn nhóm hàng vào từng sản phẩm và để cây danh mục tự do: bị loại vì một trang danh mục khi đó có thể chứa nhiều schema, khiến facets và bộ lọc không xác định được.
