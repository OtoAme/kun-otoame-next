'use client'

import { useEffect, useRef, useState } from 'react'
import { useDebounce } from 'use-debounce'
import { kunFetchDelete, kunFetchGet, kunFetchPost } from '~/utils/kunFetch'
import { Chip } from '@heroui/chip'
import { Button } from '@heroui/button'
import { useDisclosure } from '@heroui/modal'
import { CircleOff, Pencil } from 'lucide-react'
import { TagDetail } from '~/types/api/tag'
import { KunLoading } from '~/components/kun/Loading'
import { KunHeader } from '~/components/kun/Header'
import { useMounted } from '~/hooks/useMounted'
import { GalgameCard } from '~/components/galgame/Card'
import { KunNull } from '~/components/kun/Null'
import { EditTagModal } from './EditTagModal'
import { DeleteTagModal } from './DeleteTagModal'
import { KunUser } from '~/components/kun/floating-card/KunUser'
import { formatTimeDifference } from '~/utils/time'
import { useUserStore } from '~/store/userStore'
import { useRouter } from '@bprogress/next'
import { KunPagination } from '~/components/kun/Pagination'
import { FilterBar } from '~/components/galgame/FilterBar'
import type { SortField, SortOrder } from '~/components/galgame/_sort'
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
import toast from 'react-hot-toast'

interface UpdateBlockedTagResponse {
  blockedTagIds: number[]
}

interface Props {
  initialTag: TagDetail
}

const SORT_FIELDS = new Set<SortField>([
  'resource_update_time',
  'created',
  'view',
  'download',
  'favorite',
  'rating'
])

const SORT_ORDERS = new Set<SortOrder>(['asc', 'desc'])

const isDefaultFilterArray = (value: string[]) =>
  value.length === 1 && value[0] === DEFAULT_GALGAME_FILTER_VALUE

const parseSortField = (value: string | null): SortField => {
  if (value && SORT_FIELDS.has(value as SortField)) {
    return value as SortField
  }

  return DEFAULT_GALGAME_SORT_FIELD
}

const parseSortOrder = (value: string | null): SortOrder => {
  if (value && SORT_ORDERS.has(value as SortOrder)) {
    return value as SortOrder
  }

  return DEFAULT_GALGAME_SORT_ORDER
}

const getUrlFilterState = () => {
  const params =
    typeof window === 'undefined'
      ? new URLSearchParams()
      : new URLSearchParams(window.location.search)

  return {
    page: parsePositiveIntParam(params.get('page'), 1),
    selectedType: params.get('selectedType') || DEFAULT_GALGAME_FILTER_VALUE,
    selectedLanguage:
      params.get('selectedLanguage') || DEFAULT_GALGAME_FILTER_VALUE,
    selectedPlatform:
      params.get('selectedPlatform') || DEFAULT_GALGAME_FILTER_VALUE,
    sortField: parseSortField(params.get('sortField')),
    sortOrder: parseSortOrder(params.get('sortOrder')),
    selectedYears: parseGalgameFilterArray(params.get('yearString')),
    selectedMonths: parseGalgameFilterArray(params.get('monthString')),
    minRatingCount: parseNonNegativeIntParam(
      params.get('minRatingCount'),
      DEFAULT_TAG_COMPANY_MIN_RATING_COUNT
    )
  }
}

export const TagDetailContainer = ({ initialTag }: Props) => {
  const isMounted = useMounted()
  const router = useRouter()
  const { user, setUser } = useUserStore((state) => state)
  const fetchRequestId = useRef(0)
  const isSyncingFromUrl = useRef(false)
  const [isUrlReady, setIsUrlReady] = useState(false)
  const [page, setPage] = useState(1)
  const [selectedType, setSelectedType] = useState(DEFAULT_GALGAME_FILTER_VALUE)
  const [selectedLanguage, setSelectedLanguage] = useState(
    DEFAULT_GALGAME_FILTER_VALUE
  )
  const [selectedPlatform, setSelectedPlatform] = useState(
    DEFAULT_GALGAME_FILTER_VALUE
  )
  const [sortField, setSortField] = useState<SortField>(
    DEFAULT_GALGAME_SORT_FIELD
  )
  const [sortOrder, setSortOrder] = useState<SortOrder>(
    DEFAULT_GALGAME_SORT_ORDER
  )
  const [selectedYears, setSelectedYears] = useState<string[]>([
    DEFAULT_GALGAME_FILTER_VALUE
  ])
  const [selectedMonths, setSelectedMonths] = useState<string[]>([
    DEFAULT_GALGAME_FILTER_VALUE
  ])
  const [minRatingCount, setMinRatingCount] = useState(
    DEFAULT_TAG_COMPANY_MIN_RATING_COUNT
  )
  const [debouncedMinRatingCount] = useDebounce(minRatingCount, 400)

  const [tag, setTag] = useState(initialTag)
  const [patches, setPatches] = useState<GalgameCard[]>([])
  const [totalCount, setTotalCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const [updatingBlockedTag, setUpdatingBlockedTag] = useState(false)
  const { isOpen, onOpen, onClose } = useDisclosure()
  const isBlocked = user.blockedTagIds.includes(tag.id)
  const withPageReset = <T,>(setter: (value: T) => void) => {
    return (value: T) => {
      setPage(1)
      setter(value)
    }
  }

  const applyUrlFilterState = () => {
    const nextState = getUrlFilterState()

    isSyncingFromUrl.current = true
    setPage(nextState.page)
    setSelectedType(nextState.selectedType)
    setSelectedLanguage(nextState.selectedLanguage)
    setSelectedPlatform(nextState.selectedPlatform)
    setSortField(nextState.sortField)
    setSortOrder(nextState.sortOrder)
    setSelectedYears(nextState.selectedYears)
    setSelectedMonths(nextState.selectedMonths)
    setMinRatingCount(nextState.minRatingCount)
    setIsUrlReady(true)
  }

  const syncUrl = () => {
    const params = new URLSearchParams()

    if (page !== 1) {
      params.set('page', String(page))
    }
    if (selectedType !== DEFAULT_GALGAME_FILTER_VALUE) {
      params.set('selectedType', selectedType)
    }
    if (selectedLanguage !== DEFAULT_GALGAME_FILTER_VALUE) {
      params.set('selectedLanguage', selectedLanguage)
    }
    if (selectedPlatform !== DEFAULT_GALGAME_FILTER_VALUE) {
      params.set('selectedPlatform', selectedPlatform)
    }
    if (sortField !== DEFAULT_GALGAME_SORT_FIELD) {
      params.set('sortField', sortField)
    }
    if (sortOrder !== DEFAULT_GALGAME_SORT_ORDER) {
      params.set('sortOrder', sortOrder)
    }
    if (!isDefaultFilterArray(selectedYears)) {
      params.set('yearString', JSON.stringify(selectedYears))
    }
    if (!isDefaultFilterArray(selectedMonths)) {
      params.set('monthString', JSON.stringify(selectedMonths))
    }
    if (
      sortField === 'rating' &&
      minRatingCount !== DEFAULT_TAG_COMPANY_MIN_RATING_COUNT
    ) {
      params.set('minRatingCount', String(minRatingCount))
    }

    const queryString = params.toString()
    const currentQueryString =
      typeof window === 'undefined'
        ? ''
        : new URLSearchParams(window.location.search).toString()

    if (queryString !== currentQueryString) {
      router.push(queryString ? `?${queryString}` : '')
    }
  }

  const fetchPatches = async () => {
    const requestId = ++fetchRequestId.current
    setLoading(true)

    try {
      const response = await kunFetchGet<{
        galgames: GalgameCard[]
        total: number
      }>('/tag/otomegame', {
        tagId: tag.id,
        page,
        limit: 24,
        selectedType,
        selectedLanguage,
        selectedPlatform,
        sortField,
        sortOrder,
        yearString: JSON.stringify(selectedYears),
        monthString: JSON.stringify(selectedMonths),
        minRatingCount: sortField === 'rating' ? debouncedMinRatingCount : 0
      })

      if (requestId !== fetchRequestId.current) {
        return
      }

      if (typeof response === 'string') {
        kunErrorHandler(response, () => {})
        setPatches([])
        setTotalCount(0)
        return
      }

      setPatches(response.galgames)
      setTotalCount(response.total)
    } catch (error) {
      if (requestId !== fetchRequestId.current) {
        return
      }

      setPatches([])
      setTotalCount(0)
      errorReporter(error)
    } finally {
      if (requestId === fetchRequestId.current) {
        setLoading(false)
      }
    }
  }

  useEffect(() => {
    if (!isMounted) {
      return
    }

    applyUrlFilterState()
    window.addEventListener('popstate', applyUrlFilterState)

    return () => {
      window.removeEventListener('popstate', applyUrlFilterState)
    }
  }, [isMounted])

  useEffect(() => {
    if (!isMounted || !isUrlReady) {
      return
    }

    if (!user.uid || isBlocked) {
      fetchRequestId.current += 1
      setPatches([])
      setTotalCount(0)
      setLoading(false)
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
    isUrlReady,
    user.uid,
    isBlocked,
    tag.id,
    page,
    selectedType,
    selectedLanguage,
    selectedPlatform,
    sortField,
    sortOrder,
    selectedYears,
    selectedMonths,
    sortField === 'rating' ? debouncedMinRatingCount : null
  ])

  const handleToggleBlockedTag = async () => {
    if (!user.uid || updatingBlockedTag) {
      return
    }

    setUpdatingBlockedTag(true)
    try {
      const response = isBlocked
        ? await kunFetchDelete<KunResponse<UpdateBlockedTagResponse>>(
            '/user/setting/blocked-tag',
            { tagId: tag.id }
          )
        : await kunFetchPost<KunResponse<UpdateBlockedTagResponse>>(
            '/user/setting/blocked-tag',
            { tagId: tag.id }
          )

      if (typeof response === 'string') {
        toast.error(response)
        return
      }

      setUser({ ...user, blockedTagIds: response.blockedTagIds })

      if (isBlocked) {
        toast.success(`已取消屏蔽标签「${tag.name}」`)
      } else {
        fetchRequestId.current += 1
        setPatches([])
        setTotalCount(0)
        toast.success(`已屏蔽标签「${tag.name}」`)
      }
    } finally {
      setUpdatingBlockedTag(false)
    }
  }

  if (!isMounted) {
    return <KunLoading hint="正在获取标签详情中..." />
  }

  if (!user.uid) {
    return <KunNull message="请登录后查看标签详细信息" />
  }

  return (
    <div className="w-full my-4 space-y-6">
      <KunHeader
        name={tag.name}
        description={tag.introduction}
        headerEndContent={
          <Chip size="lg" color="primary">
            {tag.count} 个 OtomeGame
          </Chip>
        }
        endContent={
          <div className="flex justify-between">
            <KunUser
              user={tag.user}
              userProps={{
                name: tag.user.name,
                description: `创建于 ${formatTimeDifference(tag.created)}`,
                avatarProps: {
                  src: tag.user?.avatar
                }
              }}
            />

            <div className="flex items-center gap-2">
              <Button
                variant="flat"
                color={isBlocked ? 'default' : 'danger'}
                isLoading={updatingBlockedTag}
                onPress={handleToggleBlockedTag}
                startContent={<CircleOff />}
              >
                {isBlocked ? '取消屏蔽' : '屏蔽该标签'}
              </Button>

              <DeleteTagModal tag={tag} />

              {user.role > 2 && (
                <Button
                  variant="flat"
                  color="primary"
                  onPress={onOpen}
                  startContent={<Pencil />}
                >
                  编辑该标签
                </Button>
              )}
              <EditTagModal
                tag={tag}
                isOpen={isOpen}
                onClose={onClose}
                onSuccess={(newTag) => {
                  setTag(newTag)
                  onClose()
                }}
              />
            </div>
          </div>
        }
      />

      <FilterBar
        selectedType={selectedType}
        setSelectedType={withPageReset(setSelectedType)}
        selectedLanguage={selectedLanguage}
        setSelectedLanguage={withPageReset(setSelectedLanguage)}
        selectedPlatform={selectedPlatform}
        setSelectedPlatform={withPageReset(setSelectedPlatform)}
        sortField={sortField}
        setSortField={withPageReset(setSortField)}
        sortOrder={sortOrder}
        setSortOrder={withPageReset(setSortOrder)}
        selectedYears={selectedYears}
        setSelectedYears={withPageReset(setSelectedYears)}
        selectedMonths={selectedMonths}
        setSelectedMonths={withPageReset(setSelectedMonths)}
        minRatingCount={minRatingCount}
        setMinRatingCount={withPageReset(setMinRatingCount)}
        defaultMinRatingCount={DEFAULT_TAG_COMPANY_MIN_RATING_COUNT}
      />

      {tag.alias.length > 0 && (
        <div>
          <h2 className="mb-4 text-lg font-semibold">别名</h2>
          <div className="flex flex-wrap gap-2">
            {tag.alias.map((alias, index) => (
              <Chip key={index} variant="flat" color="secondary">
                {alias}
              </Chip>
            ))}
          </div>
        </div>
      )}

      {loading ? (
        <KunLoading hint="正在获取 OtomeGame 中..." />
      ) : (
        <div>
          <div className="grid grid-cols-2 gap-2 mx-auto sm:gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {patches.map((pa) => (
              <GalgameCard key={pa.id} patch={pa} />
            ))}
          </div>

          {totalCount > 24 && (
            <div className="flex justify-center">
              <KunPagination
                total={Math.ceil(totalCount / 24)}
                page={page}
                onPageChange={setPage}
                isLoading={loading}
              />
            </div>
          )}

          {!totalCount && <KunNull message="这个标签暂无 OtomeGame 使用" />}
        </div>
      )}
    </div>
  )
}
