import Link from 'next/link'
import { Card, CardBody } from '@heroui/card'
import { Chip } from '@heroui/chip'
import { semanticChipProps } from '~/utils/semanticColor'
import type { Company as CompanyType } from '~/types/api/company'

interface Props {
  company: CompanyType
}

export const CompanyCard = ({ company }: Props) => {
  return (
    <Card
      isPressable
      as={Link}
      href={`/company/${company.id}`}
      className="w-full"
    >
      <CardBody className="gap-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="kun-dense-card-title text-lg font-semibold transition-colors line-clamp-2 hover:text-primary-500">
            {company.name}
          </h2>
          <Chip size="sm" variant="flat">
            {company.count} 个 OtomeGame
          </Chip>
        </div>
        {company.alias.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-2">
            {company.alias.map((alias, index) => (
              <Chip key={index} size="sm" {...semanticChipProps('company')}>
                {alias}
              </Chip>
            ))}
          </div>
        )}
      </CardBody>
    </Card>
  )
}
