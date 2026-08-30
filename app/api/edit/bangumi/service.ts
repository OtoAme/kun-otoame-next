import { BANGUMI_API_BASE, BANGUMI_HEADERS } from '~/constants/bangumi'
import { lowQualityTags } from '~/lib/bgmDirtyTag'
import type {
  BangumiCompanyReference,
  BangumiDetailsResponse
} from '~/types/api/externalCompanyData'

interface BangumiTag {
  name: string
}

interface BangumiInfoboxItem {
  key: string
  value: string | { v: string }[]
}

interface BangumiSubject {
  name?: string
  name_cn?: string
  summary?: string
  tags?: BangumiTag[]
  infobox?: BangumiInfoboxItem[]
}

const dirtyTagSet = new Set(lowQualityTags)

const COMPANY_ROLE_KEYS = new Set([
  '开发',
  '游戏开发商',
  '开发商',
  '发行',
  '发行商',
  '制作',
  '製作'
])

const splitByJapaneseSeparator = (name: string): string[] =>
  name
    .split('、')
    .map((value) => value.trim())
    .filter(Boolean)

export const extractBangumiCompanyReferences = (
  infobox?: BangumiInfoboxItem[]
): BangumiCompanyReference[] => {
  if (!infobox) return []

  const references: BangumiCompanyReference[] = []
  const seen = new Set<string>()
  for (const item of infobox) {
    if (!COMPANY_ROLE_KEYS.has(item.key)) continue

    const values =
      typeof item.value === 'string'
        ? splitByJapaneseSeparator(item.value)
        : item.value.flatMap((entry) =>
            entry.v?.trim() ? splitByJapaneseSeparator(entry.v) : []
          )
    for (const name of values) {
      const key = `${item.key}\u0000${name}`
      if (seen.has(key)) continue
      seen.add(key)
      references.push({ name, sourceRole: item.key })
    }
  }

  return references
}

export const fetchBangumiDetailsData = async (
  bangumiId: string
): Promise<BangumiDetailsResponse> => {
  const response = await fetch(`${BANGUMI_API_BASE}/v0/subjects/${bangumiId}`, {
    headers: BANGUMI_HEADERS
  })
  if (!response.ok) {
    throw new Error('BANGUMI_NOT_FOUND')
  }

  const data = (await response.json()) as BangumiSubject
  const tags = (data.tags ?? [])
    .filter((tag) => !dirtyTagSet.has(tag.name))
    .map((tag) => tag.name)
  const companyReferences = extractBangumiCompanyReferences(data.infobox)

  return {
    name: data.name ?? '',
    nameCn: data.name_cn ?? '',
    summary: data.summary ?? '',
    tags,
    developers: [
      ...new Set(companyReferences.map((reference) => reference.name))
    ],
    companyReferences
  }
}
