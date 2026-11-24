import { execFileSync } from 'node:child_process'

/**
 * Clears every rate limit counter of the smoke stack (`rate_limit_bucket`) via `psql` in the `ecommerce-smoke` Postgres
 * container. Every E2E request goes through Caddy from one IP, and an E2E run places more orders than the 5 per hour
 * allowed; the smoke stack is disposable, so clearing counters here is harmless. Never use on any other stack.
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
