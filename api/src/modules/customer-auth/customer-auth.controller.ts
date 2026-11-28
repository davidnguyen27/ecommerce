import type { Request, Response } from 'express'
import { parse } from '../../core/middleware/validation.ts'
import type { ISessions } from '../auth/index.ts'
import type { CustomerAuthService } from './customer-auth.service.ts'
import { ForgotPasswordDto, RegisterDto, ResetPasswordDto, VerifyEmailDto } from './dto/index.ts'

export class CustomerAuthController {
  constructor(
    private readonly service: CustomerAuthService,
    private readonly sessions: ISessions,
  ) {}

  /** Signs the new customer in at once. */
  register = async (req: Request, res: Response) => {
    const customerId = await this.service.register(parse(RegisterDto, req.body), String(req.ip))
    await this.sessions.start(req, res, customerId, 201)
  }

  verifyEmail = async (req: Request, res: Response) => {
    await this.service.verifyEmail(parse(VerifyEmailDto, req.body).token)
    res.status(204).end()
  }

  forgotPassword = async (req: Request, res: Response) => {
    await this.service.forgotPassword(parse(ForgotPasswordDto, req.body).email, String(req.ip))
    // The same response whether or not the email has an account.
    res.status(202).end()
  }

  resetPassword = async (req: Request, res: Response) => {
    const { token, password } = parse(ResetPasswordDto, req.body)
    await this.service.resetPassword(token, password)
    res.status(204).end()
  }
}
