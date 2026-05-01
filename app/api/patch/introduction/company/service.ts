import { z } from 'zod'
import { prisma } from '~/prisma'
import { patchCompanyChangeSchema } from '~/validations/patch'

export const handlePatchCompanyAction = (type: 'add' | 'delete') => {
  const isAdd = type === 'add'
  return async (input: z.infer<typeof patchCompanyChangeSchema>) => {
    const { patchId, companyId } = input

    return await prisma.$transaction(async (prisma) => {
      if (isAdd) {
        await prisma.patch_company_relation.createMany({
          data: companyId.map((id) => ({
            patch_id: patchId,
            company_id: id
          }))
        })
      } else {
        await prisma.patch_company_relation.deleteMany({
          where: { patch_id: patchId, company_id: { in: companyId } }
        })
      }

      await prisma.patch_company.updateMany({
        where: { id: { in: companyId } },
        data: { count: { increment: isAdd ? 1 : -1 } }
      })

      return {}
    })
  }
}
