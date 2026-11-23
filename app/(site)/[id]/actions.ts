'use server'

import { cache } from 'react'
import { z } from 'zod'
import { verifyHeaderCookie } from '~/utils/actions/verifyHeaderCookie'
import { safeParseSchema } from '~/utils/actions/safeParseSchema'
import { prisma } from '~/prisma'
import { getPatchVisibilityWhere } from '~/utils/actions/getPatchVisibilityWhere'
import { getPatchPageData } from '~/app/api/patch/pageData'

const uniqueIdSchema = z.object({
  uniqueId: z.string().min(8).max(8)
})

export const kunGetPatchPageDataActions = cache(
  async (params: z.infer<typeof uniqueIdSchema>) => {
    const input = safeParseSchema(uniqueIdSchema, params)
    if (typeof input === 'string') {
      return input
    }
    const [payload, visibilityWhere] = await Promise.all([
      verifyHeaderCookie(),
      getPatchVisibilityWhere()
    ])
    const visible = await prisma.patch.findFirst({
      where: { unique_id: input.uniqueId, ...visibilityWhere },
      select: { id: true }
    })
    if (!visible) {
      const { content_limit, ...otherVisibility } = visibilityWhere
      if (content_limit) {
        const matchesOtherVisibility = await prisma.patch.findFirst({
          where: { unique_id: input.uniqueId, ...otherVisibility },
          select: { id: true }
        })
        if (matchesOtherVisibility) {
          return { blockedBy: 'content-preference' as const }
        }
      }
      return '当前内容不可见，请登录或调整内容显示与屏蔽标签后重试'
    }

    const response = await getPatchPageData(input, payload?.uid ?? 0)
    return response
  }
)
