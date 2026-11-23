import { generateKunMetadataTemplate } from './metadata'
import { CompanyDetailContainer } from '~/components/company/detail/Container'
import { getCachedCompanyById } from './data'
import { getPatchByCompany } from '~/app/api/company/service'
import { ErrorComponent } from '~/components/error/ErrorComponent'
import type { Metadata } from 'next'
import {
  getGalgamePageState,
  type GalgameSearchParams
} from '~/utils/actions/getGalgamePageState'

export const dynamic = 'force-dynamic'

interface Props {
  params: Promise<{ id: string }>
  searchParams: Promise<GalgameSearchParams>
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

export default async function Kun({ params, searchParams }: Props) {
  const { id } = await params
  const companyId = Number(id)
  const state = await getGalgamePageState(await searchParams)
  if (typeof state === 'string') return <ErrorComponent error={state} />

  const [company, galgamesResponse] = await Promise.all([
    getCachedCompanyById(companyId),
    getPatchByCompany({ companyId, ...state.input }, state.visibility)
  ])

  if (typeof company === 'string') {
    return <ErrorComponent error={company} />
  }

  if (typeof galgamesResponse === 'string') {
    return <ErrorComponent error={galgamesResponse} />
  }

  return (
    <CompanyDetailContainer
      key={JSON.stringify([companyId, state.scope, state.filters])}
      initialCompany={company}
      initialGalgames={galgamesResponse.galgames}
      initialTotal={galgamesResponse.total}
      initialScope={state.scope}
      initialFilters={state.filters}
    />
  )
}
