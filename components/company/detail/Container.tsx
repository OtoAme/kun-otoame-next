'use client'

import { useRef, useState, useTransition, useEffect } from 'react'
import { useSearchParams } from 'next/navigation'
import { useRouter } from '@bprogress/next'
import { Button, Chip } from '@heroui/react'
import { useDisclosure } from '@heroui/modal'
import { Link } from '@heroui/link'
import { Pencil } from 'lucide-react'
import { useMounted } from '~/hooks/useMounted'
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
import { kunFetchGet } from '~/utils/kunFetch'
import { SUPPORTED_LANGUAGE_MAP } from '~/constants/resource'
import { useUserStore } from '~/store/userStore'
import type { CompanyDetail } from '~/types/api/company'
import type { SortField, SortOrder } from '~/components/galgame/_sort'
import type { FC } from 'react'
import {
  DEFAULT_GALGAME_FILTER_VALUE,
  DEFAULT_GALGAME_SORT_FIELD,
  DEFAULT_GALGAME_SORT_ORDER,
  DEFAULT_TAG_COMPANY_MIN_RATING_COUNT,
  parseGalgameFilterArray,
  parseNonNegativeIntParam,
  parsePositiveIntParam
} from '~/utils/galgameFilter'
import { errorReporter, kunErrorHandler } from '~/utils/kunErrorHandler'

interface Props {
  initialCompany: CompanyDetail
  initialPatches: GalgameCard[]
  total: number
  initialPage: number
  initialSelectedType: string
  initialSelectedLanguage: string
  initialSelectedPlatform: string
  initialSortField: SortField
  initialSortOrder: SortOrder
  initialSelectedYears: string[]
  initialSelectedMonths: string[]
  initialMinRatingCount: number
}

const isDefaultFilterArray = (value: string[]) =>
  value.length === 1 && value[0] === 'all'

const isSameFilterArray = (a: string[], b: string[]) =>
  a.length === b.length && a.every((value, index) => value === b[index])

const parseFilterArray = (value: string | null): string[] => {
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

export const CompanyDetailContainer: FC<Props> = ({
  initialCompany,
  initialPatches,
  total,
  initialPage,
  initialSelectedType,
  initialSelectedLanguage,
  initialSelectedPlatform,
  initialSortField,
  initialSortOrder,
  initialSelectedYears,
  initialSelectedMonths,
  initialMinRatingCount
}) => {
  const { isOpen, onOpen, onClose } = useDisclosure()

  const isMounted = useMounted()
  const user = useUserStore((state) => state.user)
  const router = useRouter()
  const searchParams = useSearchParams()
  const isSyncingFromUrl = useRef(false)
  const [page, setPage] = useState(initialPage)
  const [selectedType, setSelectedType] = useState<string>(initialSelectedType)
  const [selectedLanguage, setSelectedLanguage] = useState<string>(
    initialSelectedLanguage
  )
  const [selectedPlatform, setSelectedPlatform] = useState<string>(
    initialSelectedPlatform
  )
  const [sortField, setSortField] = useState<SortField>(initialSortField)
  const [sortOrder, setSortOrder] = useState<SortOrder>(initialSortOrder)
  const [selectedYears, setSelectedYears] =
    useState<string[]>(initialSelectedYears)
  const [selectedMonths, setSelectedMonths] =
    useState<string[]>(initialSelectedMonths)
  const [minRatingCount, setMinRatingCount] = useState(initialMinRatingCount)

  const [company, setCompany] = useState(initialCompany)
  const [patches, setPatches] = useState<GalgameCard[]>(initialPatches)
  const [totalPatches, setTotalPatches] = useState(total)
  const [loading, startTransition] = useTransition()

  const updateFilter = <T,>(setter: (value: T) => void, value: T) => {
    setPage(1)
    setter(value)
  }

  const syncUrl = () => {
    const params = new URLSearchParams()

    if (page !== 1) {
      params.set('page', String(page))
    }
    if (selectedType !== 'all') {
      params.set('selectedType', selectedType)
    }
    if (selectedLanguage !== 'all') {
      params.set('selectedLanguage', selectedLanguage)
    }
    if (selectedPlatform !== 'all') {
      params.set('selectedPlatform', selectedPlatform)
    }
    if (sortField !== 'resource_update_time') {
      params.set('sortField', sortField)
    }
    if (sortOrder !== 'desc') {
      params.set('sortOrder', sortOrder)
    }
    if (!isDefaultFilterArray(selectedYears)) {
      params.set('yearString', JSON.stringify(selectedYears))
    }
    if (!isDefaultFilterArray(selectedMonths)) {
      params.set('monthString', JSON.stringify(selectedMonths))
    }
    if (sortField === 'rating' && minRatingCount !== 10) {
      params.set('minRatingCount', String(minRatingCount))
    }

    const queryString = params.toString()
    if (queryString !== searchParams.toString()) {
      router.push(queryString ? `?${queryString}` : '')
    }
  }

  const fetchPatches = () => {
    startTransition(async () => {
      const { galgames, total } = await kunFetchGet<{
        galgames: GalgameCard[]
        total: number
      }>('/company/otomegame', {
        companyId: company.id,
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
      setPatches(galgames)
      setTotalPatches(total)
    })
  }

  useEffect(() => {
    if (!isMounted) {
      return
    }

    if (isSyncingFromUrl.current) {
      isSyncingFromUrl.current = false
    } else {
      syncUrl()
    }
    fetchPatches()
  }, [
    isMounted,
    page,
    sortField,
    sortOrder,
    selectedType,
    selectedLanguage,
    selectedPlatform,
    selectedYears,
    selectedMonths,
    sortField === 'rating' ? minRatingCount : null
  ])

  useEffect(() => {
    if (!isMounted) {
      return
    }

    const nextPage = Number(searchParams.get('page')) || 1
    const nextSelectedType = searchParams.get('selectedType') || 'all'
    const nextSelectedLanguage = searchParams.get('selectedLanguage') || 'all'
    const nextSelectedPlatform = searchParams.get('selectedPlatform') || 'all'
    const nextSortField =
      (searchParams.get('sortField') as SortField) || 'resource_update_time'
    const nextSortOrder = (searchParams.get('sortOrder') as SortOrder) || 'desc'
    const nextSelectedYears = parseFilterArray(searchParams.get('yearString'))
    const nextSelectedMonths = parseFilterArray(searchParams.get('monthString'))
    const nextMinRatingCount = Number(searchParams.get('minRatingCount')) || 10
    const shouldSyncFromUrl =
      nextPage !== page ||
      nextSelectedType !== selectedType ||
      nextSelectedLanguage !== selectedLanguage ||
      nextSelectedPlatform !== selectedPlatform ||
      nextSortField !== sortField ||
      nextSortOrder !== sortOrder ||
      !isSameFilterArray(nextSelectedYears, selectedYears) ||
      !isSameFilterArray(nextSelectedMonths, selectedMonths) ||
      nextMinRatingCount !== minRatingCount

    if (!shouldSyncFromUrl) {
      return
    }

    isSyncingFromUrl.current = true
    setPage(nextPage)
    setSelectedType(nextSelectedType)
    setSelectedLanguage(nextSelectedLanguage)
    setSelectedPlatform(nextSelectedPlatform)
    setSortField(nextSortField)
    setSortOrder(nextSortOrder)
    setSelectedYears(nextSelectedYears)
    setSelectedMonths(nextSelectedMonths)
    setMinRatingCount(nextMinRatingCount)
  }, [searchParams])

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
              <Chip key={index} variant="flat" color="secondary">
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
              <Chip key={index} variant="flat" color="primary">
                {brand}
              </Chip>
            ))}
          </div>
        </div>
      )}

      <div className="my-6">
        <FilterBar
          selectedType={selectedType}
          setSelectedType={(value) => updateFilter(setSelectedType, value)}
          sortField={sortField}
          setSortField={(value) => updateFilter(setSortField, value)}
          sortOrder={sortOrder}
          setSortOrder={(value) => updateFilter(setSortOrder, value)}
          selectedLanguage={selectedLanguage}
          setSelectedLanguage={(value) => updateFilter(setSelectedLanguage, value)}
          selectedPlatform={selectedPlatform}
          setSelectedPlatform={(value) => updateFilter(setSelectedPlatform, value)}
          selectedYears={selectedYears}
          setSelectedYears={(value) => updateFilter(setSelectedYears, value)}
          selectedMonths={selectedMonths}
          setSelectedMonths={(value) => updateFilter(setSelectedMonths, value)}
          minRatingCount={minRatingCount}
          setMinRatingCount={(value) => updateFilter(setMinRatingCount, value)}
        />
      </div>

      {loading ? (
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
                page={page}
                onPageChange={setPage}
                isLoading={loading}
              />
            </div>
          )}

          {!totalPatches && <KunNull message="暂无 OtomeGame, 或您未开启网站 NSFW" />}
        </div>
      )}
    </div>
  )
}
