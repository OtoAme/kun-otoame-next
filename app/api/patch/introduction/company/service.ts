import { z } from 'zod'
import { prisma } from '~/prisma'
import { invalidateCompanyCaches } from '~/app/api/patch/cache'
import {
  addPatchCompanyRelations,
  removePatchCompanyRelations
} from '~/app/api/edit/companyRelationHelper'
import { patchCompanyChangeSchema } from '~/validations/patch'

export const handlePatchCompanyAction = (type: 'add' | 'delete') => {
  const isAdd = type === 'add'
  return async (input: z.infer<typeof patchCompanyChangeSchema>) => {
    const { patchId, companyId } = input

    const changedIds = await prisma.$transaction(async (tx) => {
      return isAdd
        ? await addPatchCompanyRelations(tx, patchId, companyId)
        : await removePatchCompanyRelations(tx, patchId, companyId)
    })

    if (changedIds.length) {
      await invalidateCompanyCaches()
    }

    return {}
  }
}
