import { generateKunMetadataTemplate } from './metadata'
import { CompanyDetailContainer } from '~/components/company/detail/Container'
import { getCachedCompanyById } from './data'
import { kunCompanyGalgameActions } from './actions'
import { ErrorComponent } from '~/components/error/ErrorComponent'
import type { Metadata } from 'next'
import { prisma } from '~/prisma/index'
import { STATIC_COMPANY_PREGEN_LIMIT } from '~/config/staticGeneration'
import {
  DEFAULT_GALGAME_FILTER_VALUE,
  DEFAULT_GALGAME_MONTH_STRING,
  DEFAULT_GALGAME_SORT_FIELD,
  DEFAULT_GALGAME_SORT_ORDER,
  DEFAULT_GALGAME_YEAR_STRING,
  DEFAULT_TAG_COMPANY_MIN_RATING_COUNT
} from '~/utils/galgameFilter'

export const revalidate = 600
export const dynamic = 'force-static'

interface Props {
  params: Promise<{ id: string }>
}

export const generateMetadata = async ({
  params
}: Props): Promise<Metadata> => {
  const { id } = await params
  const company = await getCachedCompanyById(Number(id))
  if (typeof company === 'string') {
    return {}
  }
  return generateKunMetadataTemplate(company)
}

export async function generateStaticParams() {
  if (STATIC_COMPANY_PREGEN_LIMIT === 0) {
    return []
  }

  const companies = await prisma.patch_company.findMany({
    orderBy: { count: 'desc' },
    take: STATIC_COMPANY_PREGEN_LIMIT,
    select: { id: true }
  })

  return companies.map((company) => ({
    id: String(company.id)
  }))
}

export default async function Kun({ params }: Props) {
  const { id } = await params
  const companyId = Number(id)

  const [company, galgamesResponse] = await Promise.all([
    getCachedCompanyById(companyId),
    kunCompanyGalgameActions({
      companyId,
      page: 1,
      limit: 24,
      selectedType: DEFAULT_GALGAME_FILTER_VALUE,
      selectedLanguage: DEFAULT_GALGAME_FILTER_VALUE,
      selectedPlatform: DEFAULT_GALGAME_FILTER_VALUE,
      sortField: DEFAULT_GALGAME_SORT_FIELD,
      sortOrder: DEFAULT_GALGAME_SORT_ORDER,
      yearString: DEFAULT_GALGAME_YEAR_STRING,
      monthString: DEFAULT_GALGAME_MONTH_STRING,
      minRatingCount: DEFAULT_TAG_COMPANY_MIN_RATING_COUNT
    })
  ])

  if (typeof company === 'string') {
    return <ErrorComponent error={company} />
  }

  if (typeof galgamesResponse === 'string') {
    return <ErrorComponent error={galgamesResponse} />
  }

  return (
    <CompanyDetailContainer
      initialCompany={company}
      initialGalgames={galgamesResponse.galgames}
      initialTotal={galgamesResponse.total}
    />
  )
}
