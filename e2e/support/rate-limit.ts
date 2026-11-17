import { execFileSync } from 'node:child_process'

/**
 * Xóa mọi bộ đếm giới hạn tần suất của stack smoke (bảng `rate_limit_bucket`), bằng `psql` trong container Postgres của
 * project `ecommerce-smoke`. Mọi request E2E đi qua Caddy từ cùng một IP, mà một lượt E2E đặt mua nhiều hơn 5 lần mỗi
 * giờ cho phép; stack smoke dùng một lần nên xóa bộ đếm ở đây không ảnh hưởng gì. Không dùng cho stack nào khác.
 */
export function resetRateLimits() {
  const project = process.env.E2E_COMPOSE_PROJECT ?? 'ecommerce-smoke'
  execFileSync(
    'docker',
    [
      'exec',
      `${project}-postgres-1`,
      'sh',
      '-c',
      'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -q -c "DELETE FROM rate_limit_bucket"',
    ],
    { stdio: ['ignore', 'ignore', 'inherit'] },
  )
}
