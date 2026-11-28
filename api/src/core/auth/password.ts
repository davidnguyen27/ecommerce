import { hash, verify } from '@node-rs/argon2'

// The library's `Algorithm` is a const enum, which cannot be imported under verbatimModuleSyntax.
const ARGON2ID = 2

export function hashPassword(password: string): Promise<string> {
  return hash(password, { algorithm: ARGON2ID })
}

export function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  return verify(passwordHash, password)
}
