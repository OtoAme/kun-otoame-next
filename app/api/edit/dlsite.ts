import { prisma } from '~/prisma/index'
import { invalidateCompanyCaches } from '~/app/api/patch/cache'
import { addPatchCompanyRelations } from './companyRelationHelper'

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

    const insertedIds = await prisma.$transaction(
      async (tx) => {
        let company = await tx.patch_company.findFirst({
          where: { name: circleName }
        })

        if (!company) {
          company = await tx.patch_company.create({
            data: {
              name: circleName,
              introduction: '',
              count: 0,
              primary_language: [],
              official_website: circleLink ? [circleLink] : [],
              parent_brand: [],
              alias: [],
              user_id: uid
            }
          })
        }

        return await addPatchCompanyRelations(tx, patchId, [company.id])
      },
      { timeout: 60000 }
    )

    if (insertedIds.length) {
      await invalidateCompanyCaches()
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
