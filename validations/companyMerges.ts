import { z } from 'zod'

export const dismissCompanyMergeSuggestionSchema = z.object({
  id: z.coerce.number().int().min(1).max(9999999)
})

const companyId = z.coerce.number().int().min(1).max(9999999)

export const applyCompanyMergeSuggestionSchema = z.object({
  id: z.coerce.number().int().min(1).max(9999999),
  // 主会社固定为簇里编号最小的那家，客户端传了也会被忽略。
  targetCompanyId: companyId.optional(),
  // 主名必须是某个参与会社的名称或别名, 服务端会在事务内再核一次。
  name: z.string().trim().min(1).max(107),
  // 记录所有者由主名原先所属会社推导，客户端传了也会被忽略。
  ownerFromCompanyId: companyId.optional(),
  introductionFromCompanyId: companyId
})
