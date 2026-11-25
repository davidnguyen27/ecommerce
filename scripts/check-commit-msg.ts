// Rejects commit messages whose subject is not an English Conventional Commits line (CODING_STANDARDS "Commit").
// Runs in the commit-msg hook (.husky/commit-msg) with the message file path as argument.
// Run by hand: node scripts/check-commit-msg.ts <file>
import { readFileSync } from 'node:fs'

const TYPES = ['feat', 'fix', 'refactor', 'perf', 'test', 'docs', 'build', 'ci', 'chore', 'style', 'revert']
const CONVENTIONAL = new RegExp(`^(${TYPES.join('|')})(\\([a-z0-9-]+\\))?!?: \\S`)
// Messages git writes itself, plus fixup/squash commits meant to be folded in later.
const GIT_GENERATED = /^(Merge |Revert "|fixup! |squash! |amend! )/
const MAX_SUBJECT = 100
const VIETNAMESE = /[àáảãạăắằẳẵặâấầẩẫậèéẻẽẹêếềểễệìíỉĩịòóỏõọôốồổỗộơớờởỡợùúủũụưứừửữựỳýỷỹỵđ]/i

const file = process.argv[2]
if (!file) {
  console.error('Usage: node scripts/check-commit-msg.ts <commit message file>')
  process.exit(2)
}
const subject =
  readFileSync(file, 'utf8')
    .split(/\r?\n/)
    .find((line) => line.trim() !== '' && !line.startsWith('#')) ?? ''

const problems: string[] = []
if (!GIT_GENERATED.test(subject)) {
  if (!CONVENTIONAL.test(subject)) problems.push(`start with "<type>(<scope>): ", type one of: ${TYPES.join(', ')}`)
  if ([...subject].length > MAX_SUBJECT) problems.push(`keep the subject within ${MAX_SUBJECT} characters`)
  // Vietnamese is allowed only inside quotes, e.g. a UI label like "Đặt trước".
  if (VIETNAMESE.test(subject.replace(/"[^"]*"/g, ''))) problems.push('write the subject in English')
}

if (problems.length) {
  console.error(`Commit message rejected: ${subject}`)
  for (const p of problems) console.error(`  - ${p}`)
  console.error('Example: feat(orders): cancel paid pre-orders')
  process.exit(1)
}
