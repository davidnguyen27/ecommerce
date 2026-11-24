// Blocks commits that leak secrets from `.env`, `.env.deploy` (deploy wizard) and `.env.infra`: the repo is public on
// GitHub. Runs in the pre-commit hook (.husky/pre-commit).
// A secret is a variable whose name contains SECRET, KEY, PASSWORD, TOKEN, HASH, or is DATABASE_URL (holds the DB
// password), at least 8 characters long. Values already in `.env.example`, comment lines included (default local keys,
// e.g. SeaweedFS), are public and skipped. Prints only variable and file names, never values.
// Run by hand: node scripts/check-staged-secrets.ts
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'

const SECRET_NAME = /SECRET|KEY|PASSWORD|TOKEN|HASH|DATABASE_URL/i
const ENV_FILES = ['.env', '.env.deploy', '.env.infra']
const MIN_LENGTH = 8

function envValues(file: string) {
  if (!existsSync(file)) return []
  return readFileSync(file, 'utf8')
    .split(/\r?\n/)
    .map((line) => /^([A-Za-z0-9_]+)=(.*)$/.exec(line.trim()))
    .filter((match) => match !== null)
    .map(([, name, raw]) => ({ name: name!, value: raw!.trim().replace(/^(["'])(.*)\1$/, '$2') }))
}

// Public default values may sit in `.env.example` comment lines, so search the whole file.
const published = existsSync('.env.example') ? readFileSync('.env.example', 'utf8') : ''
const secrets = ENV_FILES.flatMap(envValues).filter(
  ({ name, value }) => SECRET_NAME.test(name) && value.length >= MIN_LENGTH && !published.includes(value),
)
if (secrets.length === 0) process.exit(0)

// Only added lines of the staged changes, with their files.
const diff = execFileSync('git', ['diff', '--cached', '--unified=0', '--no-color', '--no-ext-diff'], {
  encoding: 'utf8',
  maxBuffer: 256 * 1024 * 1024,
})
const leaks: string[] = []
let file = ''
for (const line of diff.split('\n')) {
  if (line.startsWith('+++ ')) file = line.replace(/^\+\+\+ (b\/)?/, '')
  else if (line.startsWith('+')) {
    for (const { name } of secrets.filter(({ value }) => line.includes(value))) leaks.push(`${file}: ${name}`)
  }
}

if (leaks.length > 0) {
  console.error('Commit bị chặn: phần đã stage chứa giá trị khóa trong .env (repo công khai).')
  for (const leak of new Set(leaks)) console.error(`  ${leak}`)
  console.error('Bỏ giá trị đó khỏi file (đọc từ biến môi trường), rồi stage lại.')
  process.exit(1)
}
