// Tên tiếng Việt cho mã hành động và loại đối tượng trong nhật ký. Mã chưa có ở đây thì hiện nguyên mã.

const AUDIT_ACTION_LABELS: Record<string, string> = {
  'staff.create': 'Thêm nhân viên',
  'staff.update': 'Sửa thông tin nhân viên',
  'staff.roles.change': 'Đổi vai trò nhân viên',
  'staff.lock': 'Khóa tài khoản',
  'staff.unlock': 'Mở khóa tài khoản',
  'content.page.create': 'Tạo trang nội dung',
  'content.page.update': 'Sửa trang nội dung',
  'content.page.publish': 'Xuất bản trang nội dung',
  'legal_info.change': 'Đổi thông tin pháp lý',
  'catalog.brand.create': 'Thêm thương hiệu',
  'catalog.category.create': 'Thêm danh mục',
  'catalog.category.delete': 'Xóa danh mục',
  'catalog.attribute_schema.update': 'Sửa schema thuộc tính',
  'catalog.product.create': 'Tạo sản phẩm',
  'catalog.product.update': 'Sửa sản phẩm',
  'catalog.product.publish': 'Xuất bản sản phẩm',
  'catalog.product.policies': 'Đổi trang chính sách của sản phẩm',
  'catalog.variant.create': 'Thêm biến thể',
  'catalog.variant.update': 'Sửa biến thể',
  'price.change': 'Đổi giá',
  'media.product_image.upload': 'Tải ảnh sản phẩm',
  'media.product_image.update': 'Sửa ảnh sản phẩm',
  'media.product_image.reorder': 'Sắp xếp ảnh sản phẩm',
  'media.product_image.delete': 'Xóa ảnh sản phẩm',
  'document.upload': 'Tải chứng từ',
  'document.view': 'Xem chứng từ',
  'document.delete': 'Xóa chứng từ',
  'commitment.create': 'Thêm cam kết',
  'commitment.update': 'Sửa cam kết',
  'commitment.delete': 'Xóa cam kết',
  'commitment_type.create': 'Thêm loại cam kết',
  'commitment_type.update': 'Sửa loại cam kết',
}

const AUDIT_ENTITY_LABELS: Record<string, string> = {
  staff: 'Nhân viên',
  content_page: 'Trang nội dung',
  system_config: 'Cấu hình hệ thống',
  brand: 'Thương hiệu',
  category: 'Danh mục',
  attribute_schema: 'Schema thuộc tính',
  product: 'Sản phẩm',
  product_variant: 'Biến thể',
  product_image: 'Ảnh sản phẩm',
  product_document: 'Chứng từ',
  product_commitment: 'Cam kết',
  commitment_type: 'Loại cam kết',
}

export const AUDIT_ENTITY_TYPES = Object.keys(AUDIT_ENTITY_LABELS)

export const auditActionLabel = (action: string) => AUDIT_ACTION_LABELS[action] ?? action
export const auditEntityLabel = (entityType: string) => AUDIT_ENTITY_LABELS[entityType] ?? entityType
