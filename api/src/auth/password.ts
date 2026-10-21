import { hash, verify } from '@node-rs/argon2'

// `Algorithm` của thư viện là const enum, không import được khi bật verbatimModuleSyntax.
const ARGON2ID = 2

export function hashPassword(password: string): Promise<string> {
  return hash(password, { algorithm: ARGON2ID })
}

export function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  return verify(passwordHash, password)
}
