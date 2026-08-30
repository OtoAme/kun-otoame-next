import type { VndbProducer } from '~/lib/arnebiae/vndb'
import type {
  CompanyCandidate,
  CompanyEntityType
} from '~/app/api/company/identity/types'

const uniqueStrings = (values: Array<string | null | undefined>) => [
  ...new Set(values.map((value) => value?.trim()).filter(Boolean) as string[])
]

const validSourceUrls = (values: Array<string | null | undefined>) =>
  uniqueStrings(values).filter((value) => {
    try {
      new URL(value)
      return true
    } catch {
      return false
    }
  })

const vndbEntityType = (type?: string | null): CompanyEntityType => {
  if (type === 'co') return 'company'
  if (type === 'in') return 'individual'
  if (type === 'ng') return 'amateur_group'
  return 'unknown'
}

export const createVndbCompanyCandidate = (
  producer: VndbProducer
): CompanyCandidate | null => {
  const name = producer.name?.trim()
  if (!name) return null

  const sourceWebsites = validSourceUrls(
    producer.extlinks?.map((link) => link.url) ?? []
  )
  return {
    source: 'vndb',
    externalId: producer.id?.trim().toLowerCase() ?? '',
    name,
    aliases: uniqueStrings([
      producer.original,
      ...(producer.aliases ?? [])
    ]).filter((alias) => alias !== name),
    roles: ['developer'],
    sourceRoles: ['developer'],
    entityType: vndbEntityType(producer.type),
    externalUrls: sourceWebsites,
    primaryLanguage: producer.lang?.trim() ?? '',
    sourceWebsites
  }
}
