import { prisma } from '~/prisma/index'
import {
  invalidateCompanyCaches,
  invalidatePatchContentCache
} from '~/app/api/patch/cache'
import { applyCompanyResolution } from '~/app/api/company/identity/resolver'
import { runWithCompanyIdentityConstraintRetry } from '~/app/api/company/identity/retry'
import { createUnverifiedCompanyNameCandidates } from '~/app/api/company/identity/types'

const DLSITE_API = 'https://dlapi.arnebiae.com/api/dlsite'

export interface DlsiteApiResponse {
  rj_code: string
  title_default: string
  title_jp?: string
  title_en?: string
  release_date?: string
  tags?: string
  circle_name?: string
  circle_link?: string
}

export const fetchDlsiteData = async (
  code: string
): Promise<DlsiteApiResponse> => {
  const normalized = code.trim().toUpperCase()
  const url = `${DLSITE_API}?code=${encodeURIComponent(normalized)}`
  const response = await fetch(url)
  if (response.status === 404) {
    throw new Error('DLSITE_PRODUCT_NOT_FOUND')
  }
  if (!response.ok) {
    throw new Error('DLSITE_FETCH_FAILED')
  }
  const data = (await response.json()) as { data: DlsiteApiResponse }
  return data.data
}

export const ensurePatchCompanyFromDlsite = async (
  patchId: number,
  dlsiteCode: string | null | undefined,
  uid: number,
  prefetchedCircleName?: string | null,
  prefetchedCircleLink?: string | null
) => {
  const code = dlsiteCode?.trim()
  if (!code) return

  try {
    let circleName = prefetchedCircleName?.trim() || ''
    let circleLink = prefetchedCircleLink?.trim() || ''

    if (!circleName) {
      const data = await fetchDlsiteData(code)
      circleName = data.circle_name?.trim() ?? ''
      circleLink = data.circle_link?.trim() ?? ''
    }

    if (!circleName) return

    const sourceWebsites = (() => {
      if (!circleLink) return []
      try {
        new URL(circleLink)
        return [circleLink]
      } catch {
        return []
      }
    })()
    const candidates = createUnverifiedCompanyNameCandidates(
      'dlsite',
      [circleName],
      ['circle']
    ).map((trusted) => ({
      ...trusted,
      candidate: {
        ...trusted.candidate,
        entityType: 'amateur_group' as const,
        externalUrls: sourceWebsites,
        sourceWebsites
      }
    }))

    const result = await runWithCompanyIdentityConstraintRetry(() =>
      prisma.$transaction(
        (tx) => applyCompanyResolution(tx, patchId, candidates, uid),
        { timeout: 60000 }
      )
    )

    if (result.insertedRelationIds.length) {
      const patch = await prisma.patch.findUnique({
        where: { id: patchId },
        select: { unique_id: true }
      })
      await Promise.all([
        invalidateCompanyCaches(),
        patch ? invalidatePatchContentCache(patch.unique_id) : Promise.resolve()
      ])
    }
  } catch (error) {
    console.error('Failed to ensure DLSite company relation', {
      patchId,
      source: 'dlsite_company_relation',
      dlsiteCode: code,
      circleName: prefetchedCircleName,
      error
    })
    // 忽略同步失败，避免阻塞主流程
  }
}
