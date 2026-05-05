import { generateKunMetadataTemplate } from './metadata'
import { CompanyDetailContainer } from '~/components/company/detail/Container'
import { getCompanyById } from '~/app/api/company/service'
import { ErrorComponent } from '~/components/error/ErrorComponent'
import type { Metadata } from 'next'

export const revalidate = 600
export const dynamic = 'force-static'

interface Props {
  params: Promise<{ id: string }>
}

export const generateMetadata = async ({
  params
}: Props): Promise<Metadata> => {
  const { id } = await params
  const company = await getCompanyById({ companyId: Number(id) })
  if (typeof company === 'string') {
    return {}
  }
  return generateKunMetadataTemplate(company)
}

export default async function Kun({ params }: Props) {
  const { id } = await params

  const company = await getCompanyById({ companyId: Number(id) })
  if (typeof company === 'string') {
    return <ErrorComponent error={company} />
  }

  return <CompanyDetailContainer initialCompany={company} />
}
