import type { Request, Response } from 'express'
import type { CustomerProfile, LastShippingAddress } from '@ecommerce/shared'
import { authSubject } from '../../core/middleware/require-auth.ts'
import { parse } from '../../core/middleware/validation.ts'
import { clientOf, type ISessions } from '../auth/index.ts'
import type { CustomerService } from './customer.service.ts'
import { ChangePasswordDto } from './dto/index.ts'

export class CustomerController {
  constructor(
    private readonly service: CustomerService,
    private readonly sessions: ISessions,
  ) {}

  me = async (req: Request, res: Response) => {
    const body: CustomerProfile = await this.service.profile(authSubject(req))
    res.json(body)
  }

  shippingAddress = async (req: Request, res: Response) => {
    const body: LastShippingAddress = await this.service.shippingAddress(authSubject(req))
    res.set('Cache-Control', 'no-store').json(body)
  }

  resendVerification = async (req: Request, res: Response) => {
    const sent = await this.service.resendVerification(authSubject(req))
    res.status(sent ? 202 : 204).end()
  }

  changePassword = async (req: Request, res: Response) => {
    // Check the channel before changing anything, so opening the new session at the end cannot fail.
    clientOf(req)
    const { currentPassword, newPassword } = parse(ChangePasswordDto, req.body)
    const customerId = authSubject(req)
    await this.service.changePassword(customerId, currentPassword, newPassword)
    // Every session was revoked; the device changing the password gets a new one so it stays signed in.
    await this.sessions.start(req, res, customerId)
  }
}
