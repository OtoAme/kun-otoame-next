'use client'

import { useState } from 'react'
import { useDebounce } from 'use-debounce'
import { useAccountPreferences } from '~/hooks/useAccountPreferences'
import { useGalgameList } from '~/hooks/useGalgameList'
import { useGalgameFilters } from '~/hooks/useGalgameFilters'
import type { SessionRenderState } from '~/types/api/session'
import { usePreferenceStore } from '~/store/preferenceStore'
import {
  editPreference,
  refreshPreferences,
  savePreferenceDrafts
} from '~/utils/preferenceClient'
import { Chip } from '@heroui/chip'
import { Button } from '@heroui/button'
import { useDisclosure } from '@heroui/modal'
import { CircleOff, Pencil } from 'lucide-react'
import { TagDetail } from '~/types/api/tag'
import { KunLoading } from '~/components/kun/Loading'
import { KunHeader } from '~/components/kun/Header'
import { GalgameCard } from '~/components/galgame/Card'
import { KunNull } from '~/components/kun/Null'
import { EditTagModal } from './EditTagModal'
import { DeleteTagModal } from './DeleteTagModal'
import { KunUser } from '~/components/kun/floating-card/KunUser'
import { formatTimeDifference } from '~/utils/time'
import { useUserStore } from '~/store/userStore'
import { KunPagination } from '~/components/kun/Pagination'
import { FilterBar } from '~/components/galgame/FilterBar'
import {
  DEFAULT_TAG_COMPANY_MIN_RATING_COUNT,
  getGalgameListQuery,
  type TagCompanyGalgameFilterState
} from '~/utils/galgameFilter'
import toast from 'react-hot-toast'

interface Props {
  initialTag: TagDetail
  initialGalgames: GalgameCard[]
  initialTotal: number
  initialScope?: SessionRenderState | null
  initialFilters?: TagCompanyGalgameFilterState
}

export const TagDetailContainer = ({
  initialTag,
  initialGalgames,
  initialTotal,
  initialScope = null,
  initialFilters
}: Props) => {
  const { user, sessionContext, sessionGeneration, sessionStatus } =
    useUserStore()
  const preferences = useAccountPreferences()
  const [tag, setTag] = useState(initialTag)
  const [updatingBlockedTag, setUpdatingBlockedTag] = useState(false)
  const { isOpen, onOpen, onClose } = useDisclosure()
  const isBlocked =
    preferences.snapshot?.blockedTagIds.includes(tag.id) ?? false
  const { filters, setPage, filterProps } = useGalgameFilters(
    initialFilters,
    DEFAULT_TAG_COMPANY_MIN_RATING_COUNT
  )
  const [debouncedMinRatingCount] = useDebounce(filters.minRatingCount, 400)
  const {
    galgames,
    total,
    loading: waiting,
    error,
    ready,
    retry
  } = useGalgameList(
    '/tag/otomegame',
    {
      ...getGalgameListQuery({
        ...filters,
        minRatingCount: debouncedMinRatingCount
      }),
      tagId: tag.id
    },
    { galgames: initialGalgames, total: initialTotal },
    initialScope,
    !isBlocked && sessionStatus !== 'guest'
  )
  const patches = isBlocked ? [] : galgames
  const totalCount = isBlocked ? 0 : total

  const handleToggleBlockedTag = async () => {
    if (!user.uid || !preferences.canEdit || updatingBlockedTag) {
      return
    }

    setUpdatingBlockedTag(true)
    try {
      const key = `blocked-tag:${tag.id}`
      await refreshPreferences([tag.id])
      const current = useUserStore.getState()
      if (
        current.user.uid !== user.uid ||
        current.sessionContext !== sessionContext ||
        current.sessionGeneration !== sessionGeneration
      ) {
        toast.error('登录账号或会话已变化，请重新确认')
        return
      }
      if (!usePreferenceStore.getState().applied?.items[key]) {
        toast.error('设置读取失败，请重试')
        return
      }
      editPreference(key, !isBlocked)
      if (!(await savePreferenceDrafts([key]))) {
        toast.error(usePreferenceStore.getState().error || '保存失败，请重试')
        return
      }

      if (isBlocked) {
        toast.success(`已取消屏蔽标签「${tag.name}」`)
      } else {
        toast.success(`已屏蔽标签「${tag.name}」`)
      }
    } finally {
      setUpdatingBlockedTag(false)
    }
  }

  if (
    sessionStatus === 'guest' ||
    (sessionStatus === 'checking' && initialScope?.identity === 'guest')
  ) {
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
                isDisabled={!preferences.canEdit}
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

      <FilterBar {...filterProps} />

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
          <div className="grid grid-cols-2 gap-2 mx-auto sm:gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {patches.map((pa) => (
              <GalgameCard key={pa.id} patch={pa} />
            ))}
          </div>

          {totalCount > 24 && (
            <div className="flex justify-center">
              <KunPagination
                total={Math.ceil(totalCount / 24)}
                page={filters.page}
                onPageChange={setPage}
                isLoading={waiting}
              />
            </div>
          )}

          {!totalCount && <KunNull message="这个标签暂无 OtomeGame 使用" />}
        </div>
      )}
    </div>
  )
}
