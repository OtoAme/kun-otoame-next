import { generateKunMetadataTemplate } from './metadata'
import { CompanyDetailContainer } from '~/components/company/detail/Container'
import { kunGetCompanyByIdActions, kunCompanyGalgameActions } from './actions'
import { ErrorComponent } from '~/components/error/ErrorComponent'
import type { SortField, SortOrder } from '~/components/galgame/_sort'
import type { Metadata } from 'next'
import {
  DEFAULT_GALGAME_FILTER_VALUE,
  DEFAULT_GALGAME_MONTH_STRING,
  DEFAULT_GALGAME_SORT_FIELD,
  DEFAULT_GALGAME_SORT_ORDER,
  DEFAULT_TAG_COMPANY_MIN_RATING_COUNT,
  DEFAULT_GALGAME_YEAR_STRING,
  getSearchParamValue,
  parseNonNegativeIntParam,
  parsePositiveIntParam
} from '~/utils/galgameFilter'

export const revalidate = 600

interface Props {
  params: Promise<{ id: string }>
  searchParams?: Promise<{
    page?: string
    selectedType?: string
    selectedLanguage?: string
    selectedPlatform?: string
    sortField?: SortField
    sortOrder?: SortOrder
    yearString?: string
    monthString?: string
    minRatingCount?: string
  }>
}

const parseFilterArray = (value: string | undefined): string[] => {
  if (!value) {
    return ['all']
  }

  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed) && parsed.length > 0
      ? parsed.filter((item): item is string => typeof item === 'string')
      : ['all']
  } catch {
    return ['all']
  }
}

export const generateMetadata = async ({
  params
}: Props): Promise<Metadata> => {
  const { id } = await params
  const company = await kunGetCompanyByIdActions({ companyId: Number(id) })
  if (typeof company === 'string') {
    return {}
  }
  return generateKunMetadataTemplate(company)
}

export default async function Kun({ params, searchParams }: Props) {
  const { id } = await params
  const res = await searchParams

  const page = Number(res?.page) || 1
  const selectedType = res?.selectedType || 'all'
  const selectedLanguage = res?.selectedLanguage || 'all'
  const selectedPlatform = res?.selectedPlatform || 'all'
  const sortField = res?.sortField || 'resource_update_time'
  const sortOrder = res?.sortOrder || 'desc'
  const selectedYears = parseFilterArray(res?.yearString)
  const selectedMonths = parseFilterArray(res?.monthString)
  const minRatingCount = Number(res?.minRatingCount) || 10

  const company = await kunGetCompanyByIdActions({ companyId: Number(id) })
  if (typeof company === 'string') {
    return <ErrorComponent error={company} />
  }

  const response = await kunCompanyGalgameActions({
    companyId: Number(id),
    page,
    limit: 24,
    selectedType,
    selectedLanguage,
    selectedPlatform,
    sortField,
    sortOrder,
    yearString: JSON.stringify(selectedYears),
    monthString: JSON.stringify(selectedMonths),
    minRatingCount: sortField === 'rating' ? minRatingCount : 0
  })
  if (typeof response === 'string') {
    return <ErrorComponent error={response} />
  }

  return (
    <CompanyDetailContainer
      initialCompany={company}
      initialPatches={response.galgames}
      total={response.total}
      initialPage={page}
      initialSelectedType={selectedType}
      initialSelectedLanguage={selectedLanguage}
      initialSelectedPlatform={selectedPlatform}
      initialSortField={sortField}
      initialSortOrder={sortOrder}
      initialSelectedYears={selectedYears}
      initialSelectedMonths={selectedMonths}
      initialMinRatingCount={minRatingCount}
    />
  )
}
