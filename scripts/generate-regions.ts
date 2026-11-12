/**
 * Sinh danh mục hành chính tĩnh cho `@ecommerce/shared` từ bộ dữ liệu mở thanglequoc/vietnamese-provinces-database
 * (MIT; dựng từ danh mục mã đơn vị hành chính của Cục Thống kê theo các nghị quyết sắp xếp áp dụng từ 01/07/2025).
 *
 * Cách chạy (tải file ở đúng commit rồi sinh lại, xong chạy Prettier):
 *   curl -L -o vn_units.json https://raw.githubusercontent.com/thanglequoc/vietnamese-provinces-database/<commit>/json/full_json_generated_data_vn_units.json
 *   pnpm generate-regions vn_units.json <commit>
 *   pnpm exec prettier --write shared/src/provinces.generated.ts shared/src/wards.generated.ts
 */
import { readFileSync, writeFileSync } from 'node:fs'

type SourceWard = { Code: string; FullName: string; ProvinceCode: string }
type SourceProvince = { Code: string; Name: string; FullName: string; Wards: SourceWard[] }

const [input, commit] = process.argv.slice(2)
if (!input || !commit) {
  console.error('Dùng: node scripts/generate-regions.ts <full_json_generated_data_vn_units.json> <commit>')
  process.exit(1)
}

const provinces = (JSON.parse(readFileSync(input, 'utf8')) as SourceProvince[]).sort((a, b) =>
  a.Code.localeCompare(b.Code),
)
const wardCount = provinces.reduce((n, p) => n + p.Wards.length, 0)
if (provinces.length !== 34) throw new Error(`Cần 34 tỉnh/thành, có ${provinces.length}`)

const source = `thanglequoc/vietnamese-provinces-database@${commit} (json/full_json_generated_data_vn_units.json, MIT)`
const header = (what: string) => `// File sinh tự động bởi scripts/generate-regions.ts, không sửa tay.
// ${what} theo danh mục đơn vị hành chính áp dụng từ 01/07/2025 (không còn cấp quận/huyện).
// Nguồn: ${source}, dựng từ danh mục mã đơn vị hành chính của Cục Thống kê.
`

writeFileSync(
  new URL('../shared/src/provinces.generated.ts', import.meta.url),
  `${header(`${provinces.length} tỉnh/thành`)}
export const PROVINCES = ${JSON.stringify(
    provinces.map((p) => ({ code: p.Code, name: p.Name, fullName: p.FullName })),
  )} as const
`,
)

const wards = Object.fromEntries(
  provinces.map((p) => [
    p.Code,
    p.Wards.filter((w) => w.ProvinceCode === p.Code)
      .sort((a, b) => a.Code.localeCompare(b.Code))
      .map((w) => [w.Code, w.FullName]),
  ]),
)
writeFileSync(
  new URL('../shared/src/wards.generated.ts', import.meta.url),
  `${header(`${wardCount} phường/xã/đặc khu`)}
/** Mã tỉnh/thành → danh sách [mã phường/xã, tên đầy đủ], theo mã tăng dần. */
export const WARDS_BY_PROVINCE: Readonly<Record<string, readonly (readonly [code: string, name: string])[]>> =
  ${JSON.stringify(wards)}
`,
)
console.log(`Đã sinh ${provinces.length} tỉnh/thành, ${wardCount} phường/xã`)
