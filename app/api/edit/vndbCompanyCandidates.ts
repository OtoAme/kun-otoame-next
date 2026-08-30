import { createVndbCompanyCandidate } from '~/app/api/company/identity/candidates'
import { fetchVndbVn, type VndbProducer } from '~/lib/arnebiae/vndb'
import type { TrustedCompanyCandidate } from '~/app/api/company/identity/types'

export const loadVndbDevelopers = async (id: string) => {
  const data = await fetchVndbVn<{
    developers?: VndbProducer[] | null
  }>(
    ['id', '=', id],
    'id,developers{id,name,original,aliases,lang,type,description,extlinks{url}}'
  )

  return (data.results?.[0]?.developers ?? []).filter(
    (developer) =>
      developer &&
      (developer.type === 'co' ||
        developer.type === 'ng' ||
        developer.type === 'in')
  ) as VndbProducer[]
}

export const fetchVerifiedVndbCompanyCandidates = async (
  vndbId: string
): Promise<TrustedCompanyCandidate[]> => {
  const id = vndbId.trim().toLowerCase()
  if (!id) return []
  const developers = await loadVndbDevelopers(id)
  return developers.flatMap((developer) => {
    const candidate = createVndbCompanyCandidate(developer)
    return candidate ? [{ trust: 'verified' as const, candidate }] : []
  })
}
