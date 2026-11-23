import { galgameSchema } from '~/validations/galgame'
import { safeParseSchema } from './safeParseSchema'
import { getSessionRenderState } from './getSessionRenderState'
import { getPatchVisibilityWhere } from './getPatchVisibilityWhere'
import {
  getGalgameListQuery,
  getSearchParamValue,
  readGalgameFilters
} from '~/utils/galgameFilter'

export type GalgameSearchParams = Record<string, string | string[] | undefined>

export const getGalgamePageState = async (
  searchParams: GalgameSearchParams = {},
  defaultMinRatingCount = 0
) => {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(searchParams)) {
    const first = getSearchParamValue(value)
    if (first !== undefined) params.set(key, first)
  }
  const filters = readGalgameFilters(params, defaultMinRatingCount)
  const input = safeParseSchema(galgameSchema, getGalgameListQuery(filters))
  if (typeof input === 'string') return input
  const [scope, visibility] = await Promise.all([
    getSessionRenderState(),
    getPatchVisibilityWhere()
  ])
  if (!scope || scope.browsingKey === null) return '浏览条件读取失败，请重试'
  return { filters, input, scope, visibility }
}
