import type { CommitmentType as CommitmentTypeBody } from '@ecommerce/shared'
import type { CommitmentType } from '../../generated/prisma/client.ts'

export const toCommitmentTypeBody = ({ id, name, kind }: CommitmentType): CommitmentTypeBody => ({ id, name, kind })

/** Business fields recorded in audit. */
export const commitmentTypeAuditFields = ({ name, kind }: CommitmentType) => ({ name, kind })
