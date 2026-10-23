import { describe, expect, it } from 'vitest'
import { OWNER, appWithOwner, bearer, createStaff, login } from './support/staff.ts'

const LEGAL = {
  companyName: 'Công ty TNHH Thời Trang Nhập Khẩu',
  businessRegistrationNumber: '0312345678',
  businessRegistrationIssuedBy: 'Sở Kế hoạch và Đầu tư TP. Hồ Chí Minh',
  businessRegistrationIssuedOn: '2020-03-12',
  address: '12 Nguyễn Huệ, Quận 1, TP. Hồ Chí Minh',
  phone: '028 1234 5678',
  email: 'lienhe@example.com',
  moitLogoUrl: 'https://cdn.example.com/da-thong-bao-bct.png',
  moitNoticeUrl: 'http://online.gov.vn/Home/WebDetails/12345',
}

describe('thông tin pháp lý ở chân trang', () => {
  it('chưa cấu hình thì API công khai trả các trường rỗng', async () => {
    const { request } = await appWithOwner()

    const res = await request.get('/api/legal-info')

    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ companyName: '', moitLogoUrl: '' })
  })

  it('sửa trong quản trị thì khách thấy ngay, và việc sửa được ghi audit', async () => {
    const { request } = await appWithOwner()
    const owner = await login(request, OWNER.email, OWNER.password)

    const save = await request.put('/api/admin/legal-info').set(bearer(owner.accessToken)).send(LEGAL)
    await request
      .put('/api/admin/legal-info')
      .set(bearer(owner.accessToken))
      .send({ ...LEGAL, phone: '028 9999 9999' })

    expect(save.status).toBe(200)
    expect((await request.get('/api/legal-info')).body).toEqual({ ...LEGAL, phone: '028 9999 9999' })
    const audit = await request.get('/api/admin/audit').set(bearer(owner.accessToken))
    expect(audit.body.items.map((e: { action: string }) => e.action)).toEqual([
      'legal_info.change',
      'legal_info.change',
    ])
    expect(audit.body.items[0]).toMatchObject({ before: { phone: LEGAL.phone }, after: { phone: '028 9999 9999' } })
  })

  it('thiếu content.edit thì không sửa được', async () => {
    const { request } = await appWithOwner()
    const owner = await login(request, OWNER.email, OWNER.password)
    const accountant = await createStaff(request, owner.accessToken, ['accountant'])

    const res = await request.put('/api/admin/legal-info').set(bearer(accountant.accessToken)).send(LEGAL)

    expect(res.status).toBe(403)
    expect((await request.get('/api/legal-info')).body.companyName).toBe('')
  })

  it('đường dẫn logo không phải http(s) thì 400', async () => {
    const { request } = await appWithOwner()
    const owner = await login(request, OWNER.email, OWNER.password)

    const res = await request
      .put('/api/admin/legal-info')
      .set(bearer(owner.accessToken))
      .send({ ...LEGAL, moitLogoUrl: 'javascript:alert(1)' })

    expect(res.status).toBe(400)
    expect(res.body.error.fields.map((f: { path: string }) => f.path)).toEqual(['moitLogoUrl'])
  })
})
