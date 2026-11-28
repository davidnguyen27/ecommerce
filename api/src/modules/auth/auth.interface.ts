import type { Request, Response } from 'express'

/** The accounts of one auth domain, as sessions need them. */
export interface SessionAccounts {
  /** Returns only accounts allowed to sign in; locked accounts give `null`. */
  findCredentials(email: string): Promise<{ id: string; passwordHash: string } | null>
  /** Rechecked on refresh, in case the account was locked mid-rotation. */
  isActive(subjectId: string): Promise<boolean>
}

/** What other modules use: open a session from their own route (sign-up, password change). */
export interface ISessions {
  /** Opens a new session for `subjectId` and responds with tokens for the request's channel. */
  start(req: Request, res: Response, subjectId: string, status?: number): Promise<void>
}
