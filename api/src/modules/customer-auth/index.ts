// Leaf files first, the module last (see modules/order/index.ts).
// The account module resends verification and changes passwords with these.
export { sendVerificationEmail } from './email-verification.ts'
export { setCustomerPassword } from './password-reset.ts'
export { CustomerAuthModule } from './customer-auth.module.ts'
