// Chặn commit làm lộ khóa trong `.env`: repo công khai trên GitHub. Chạy trong hook pre-commit (.husky/pre-commit).
// Khóa là biến có tên chứa SECRET, KEY, PASSWORD, TOKEN hay HASH, dài từ 8 ký tự. Giá trị đã có trong `.env.example`,
// kể cả trong dòng chú thích (khóa local mặc định, ví dụ SeaweedFS), là công khai sẵn nên bỏ qua.
// Chỉ in tên biến và file, không in giá trị.
// Chạy tay: node scripts/check-staged-secrets.ts
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'

const SECRET_NAME = /SECRET|KEY|PASSWORD|TOKEN|HASH/i
const MIN_LENGTH = 8

function envValues(file: string) {
  if (!existsSync(file)) return []
  return readFileSync(file, 'utf8')
    .split(/\r?\n/)
    .map((line) => /^([A-Za-z0-9_]+)=(.*)$/.exec(line.trim()))
    .filter((match) => match !== null)
    .map(([, name, raw]) => ({ name: name!, value: raw!.trim().replace(/^(["'])(.*)\1$/, '$2') }))
}

// Giá trị mặc định công khai có thể nằm trong dòng chú thích của `.env.example`, nên tìm trên cả file.
const published = existsSync('.env.example') ? readFileSync('.env.example', 'utf8') : ''
const secrets = envValues('.env').filter(
  ({ name, value }) => SECRET_NAME.test(name) && value.length >= MIN_LENGTH && !published.includes(value),
)
if (secrets.length === 0) process.exit(0)

// Chỉ các dòng thêm mới của phần đã stage, kèm file chứa dòng đó.
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
