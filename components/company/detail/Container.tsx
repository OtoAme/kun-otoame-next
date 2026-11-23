'use client'

import { useState } from 'react'
import { useRouter } from '@bprogress/next'
import { Button, Chip } from '@heroui/react'
import { useDisclosure } from '@heroui/modal'
import { Link } from '@heroui/link'
import { Pencil } from 'lucide-react'
import { useGalgameList } from '~/hooks/useGalgameList'
import { useGalgameFilters } from '~/hooks/useGalgameFilters'
import type { SessionRenderState } from '~/types/api/session'
import { KunHeader } from '~/components/kun/Header'
import { KunUser } from '~/components/kun/floating-card/KunUser'
import { KunLoading } from '~/components/kun/Loading'
import { GalgameCard } from '~/components/galgame/Card'
import { FilterBar } from '~/components/galgame/FilterBar'
import { KunNull } from '~/components/kun/Null'
import { KunPagination } from '~/components/kun/Pagination'
import { CompanyFormModal } from '../form/CompanyFormModal'
import { DeleteCompanyModal } from './DeleteCompanyModal'
import { formatTimeDifference } from '~/utils/time'
import { SUPPORTED_LANGUAGE_MAP } from '~/constants/resource'
import { useUserStore } from '~/store/userStore'
import { semanticChipProps } from '~/utils/semanticColor'
import type { CompanyDetail } from '~/types/api/company'
import type { FC } from 'react'
import {
  DEFAULT_TAG_COMPANY_MIN_RATING_COUNT,
  getGalgameListQuery,
  type TagCompanyGalgameFilterState
} from '~/utils/galgameFilter'

interface Props {
  initialCompany: CompanyDetail
  initialGalgames: GalgameCard[]
  initialTotal: number
  initialScope?: SessionRenderState | null
  initialFilters?: TagCompanyGalgameFilterState
}

export const CompanyDetailContainer: FC<Props> = ({
  initialCompany,
  initialGalgames,
  initialTotal,
  initialScope = null,
  initialFilters
}) => {
  const { isOpen, onOpen, onClose } = useDisclosure()
  const user = useUserStore((state) => state.user)
  const router = useRouter()
  const [company, setCompany] = useState(initialCompany)
  const { filters, setPage, filterProps } = useGalgameFilters(
    initialFilters,
    DEFAULT_TAG_COMPANY_MIN_RATING_COUNT
  )
  const {
    galgames: patches,
    total: totalPatches,
    loading: waiting,
    error,
    ready,
    retry
  } = useGalgameList(
    '/company/otomegame',
    { ...getGalgameListQuery(filters), companyId: company.id },
    { galgames: initialGalgames, total: initialTotal },
    initialScope
  )

  return (
    <div className="w-full my-4 space-y-6">
      <KunHeader
        name={company.name}
        description={company.introduction}
        headerEndContent={
          <Chip size="lg" color="primary">
            {company.count} 个 OtomeGame
          </Chip>
        }
        endContent={
          <div className="flex justify-between mb-4">
            <KunUser
              user={company.user}
              userProps={{
                name: company.user.name,
                description: `创建于 ${formatTimeDifference(company.created)}`,
                avatarProps: {
                  src: company.user?.avatar
                }
              }}
            />

            {user.role > 2 && (
              <div className="flex gap-2">
                <Button
                  variant="flat"
                  color="primary"
                  onPress={onOpen}
                  startContent={<Pencil />}
                >
                  编辑会社信息
                </Button>
                <DeleteCompanyModal company={company} />
              </div>
            )}
            <CompanyFormModal
              type="edit"
              company={company}
              isOpen={isOpen}
              onClose={onClose}
              onSuccess={(newCompany) => {
                setCompany(newCompany as CompanyDetail)
                onClose()
                router.refresh()
              }}
            />
          </div>
        }
      />

      {company.alias.length > 0 && (
        <div>
          <h2 className="mb-2 text-lg font-semibold">别名</h2>
          <div className="flex flex-wrap gap-2">
            {company.alias.map((alias, index) => (
              <Chip key={index} {...semanticChipProps('company')}>
                {alias}
              </Chip>
            ))}
          </div>
        </div>
      )}

      {company.official_website.length > 0 && (
        <div>
          <h2 className="mb-2 text-lg font-semibold">官网地址</h2>
          <div className="flex flex-wrap gap-2">
            {company.official_website.map((site, index) => (
              <Link showAnchorIcon isExternal href={site} key={index}>
                {site}
              </Link>
            ))}
          </div>
        </div>
      )}

      {company.primary_language.length > 0 && (
        <div>
          <h2 className="mb-4 text-lg font-semibold">主语言</h2>
          <div className="flex flex-wrap gap-2">
            {company.primary_language.map((language, index) => (
              <Chip key={index} variant="flat" color="success">
                {SUPPORTED_LANGUAGE_MAP[language]}
              </Chip>
            ))}
          </div>
        </div>
      )}

      {company.parent_brand.length > 0 && (
        <div>
          <h2 className="mb-4 text-lg font-semibold">父会社</h2>
          <div className="flex flex-wrap gap-2">
            {company.parent_brand.map((brand, index) => (
              <Chip key={index} {...semanticChipProps('company')}>
                {brand}
              </Chip>
            ))}
          </div>
        </div>
      )}

      <div className="my-6">
        <FilterBar {...filterProps} />
      </div>

      {error ? (
        <div role="alert">
          游戏列表读取失败，请重试。
          <Button
            onPress={() => {
              retry()
            }}
            isDisabled={!ready}
          >
            重试
          </Button>
        </div>
      ) : waiting ? (
        <KunLoading hint="正在获取 OtomeGame 中..." />
      ) : (
        <div>
          <div className="grid grid-cols-2 gap-2 mx-auto mb-8 sm:gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {patches.map((patch) => (
              <GalgameCard key={patch.id} patch={patch} />
            ))}
          </div>

          {totalPatches > 24 && (
            <div className="flex justify-center">
              <KunPagination
                total={Math.ceil(totalPatches / 24)}
                page={filters.page}
                onPageChange={setPage}
                isLoading={waiting}
              />
            </div>
          )}

          {!totalPatches && (
            <KunNull message="暂无 OtomeGame, 或您未开启网站 NSFW" />
          )}
        </div>
      )}
    </div>
  )
}
