'use client'

import { useEffect, useState } from 'react'
import { Button } from '@heroui/button'
import { kunFetchGet } from '~/utils/kunFetch'
import { KunPagination } from '~/components/kun/Pagination'
import { KunLoading } from '~/components/kun/Loading'
import { KunNull } from '~/components/kun/Null'
import { PROFILE_ENTRY_PAGE_SIZE } from '~/constants/user'
import { GalgameCard } from '~/components/galgame/Card'

interface Props {
  galgames: GalgameCard[]
  total: number
  uid: number
}

export const UserPatch = ({ galgames, total, uid }: Props) => {
  const [patches, setPatches] = useState<GalgameCard[]>(galgames)
  const [loading, setLoading] = useState(false)
  const [page, setPage] = useState(1)

  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    setError('')
    if (page === 1) {
      setPatches(galgames)
      setLoading(false)
      return
    }
    const controller = new AbortController()
    setLoading(true)
    kunFetchGet<{ galgames: GalgameCard[] } | string>(
      '/user/profile/patch',
      { uid, page, limit: PROFILE_ENTRY_PAGE_SIZE },
      { signal: controller.signal }
    )
      .then((response) => {
        if (controller.signal.aborted) return
        if (typeof response === 'string') setError(response)
        else setPatches(response.galgames)
      })
      .catch(() => {
        if (!controller.signal.aborted) setError('发布条目加载失败')
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })
    return () => controller.abort()
  }, [page, galgames, uid, attempt])

  return (
    <div className="space-y-4">
      {loading ? (
        <KunLoading hint="正在获取发布的条目..." />
      ) : error ? (
        <div role="alert" className="flex items-center justify-center gap-2">
          {error}
          <Button
            size="sm"
            variant="light"
            onPress={() => setAttempt(attempt + 1)}
          >
            重试
          </Button>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {patches.map((patch) => (
            <GalgameCard key={patch.id} patch={patch} />
          ))}
        </div>
      )}

      {!total && <KunNull message="这个孩子还没有发布过条目哦" />}

      {total > PROFILE_ENTRY_PAGE_SIZE && (
        <div className="flex justify-center">
          <KunPagination
            total={Math.ceil(total / PROFILE_ENTRY_PAGE_SIZE)}
            page={page}
            onPageChange={setPage}
            isLoading={loading}
          />
        </div>
      )}
    </div>
  )
}
