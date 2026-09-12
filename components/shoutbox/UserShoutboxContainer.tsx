'use client'

import { useCallback, useRef, useState } from 'react'
import { Alert } from '@heroui/alert'
import { Button } from '@heroui/button'
import { KunNull } from '~/components/kun/Null'
import { KunPagination } from '~/components/kun/Pagination'
import { useUserStore } from '~/store/userStore'
import { kunFetchGet } from '~/utils/kunFetch'
import { ShoutboxCard } from './ShoutboxCard'
import type {
  ShoutboxItem,
  ShoutboxProfileResponse
} from '~/types/api/shoutbox'

interface Props {
  uid: number
  initialData: ShoutboxProfileResponse
}

/**
 * Author profile shoutbox tab. The whole /user section requires login; the
 * author (and site staff) see every record with its status label, while other
 * logged-in users get the server-filtered public view. Records are never
 * physically removed: a self-deleted row stays visible to its author with the
 * corresponding status chip.
 */
export const UserShoutboxContainer = ({ uid, initialData }: Props) => {
  const [data, setData] = useState<ShoutboxProfileResponse>(initialData)
  const [error, setError] = useState('')
  const [fetching, setFetching] = useState(false)
  const seqRef = useRef(0)
  const pageRef = useRef(initialData.page)
  const currentUserId = useUserStore((state) => state.user.uid)

  const load = useCallback(
    async (targetPage: number) => {
      const seq = ++seqRef.current
      setFetching(true)
      setError('')
      try {
        const result = await kunFetchGet<ShoutboxProfileResponse | string>(
          '/user/profile/shoutbox',
          { uid, page: targetPage, limit: 6 }
        )
        if (seq !== seqRef.current) {
          return
        }
        if (typeof result === 'string') {
          setError(result || '获取小喇叭失败，请稍后重试')
          return
        }
        pageRef.current = result.page
        setData(result)
      } catch {
        if (seq !== seqRef.current) {
          return
        }
        setError('网络错误，请稍后重试')
      } finally {
        if (seq === seqRef.current) {
          setFetching(false)
        }
      }
    },
    [uid]
  )

  const handlePageChange = (next: number) => {
    if (next === pageRef.current) {
      return
    }
    void load(next)
  }

  const handleChanged = (updated: ShoutboxItem) => {
    setData((current) => ({
      ...current,
      shoutboxes: current.shoutboxes.map((row) =>
        row.id === updated.id ? updated : row
      )
    }))
  }

  const handleDeleted = (id: number) => {
    setData((current) => ({
      ...current,
      shoutboxes: current.shoutboxes.map((row) =>
        row.id === id ? { ...row, status: 1 as const } : row
      )
    }))
  }

  return (
    <div className="space-y-4">
      {error && (
        <Alert
          color="danger"
          variant="flat"
          description={error}
          endContent={
            <Button
              size="sm"
              variant="light"
              color="danger"
              onPress={() => void load(pageRef.current)}
            >
              重试
            </Button>
          }
        />
      )}

      {data.shoutboxes.length === 0 ? (
        <KunNull message="暂无小喇叭记录" />
      ) : (
        <div className="space-y-3">
          {data.shoutboxes.map((item) => (
            <ShoutboxCard
              key={item.id}
              item={item}
              showStatus
              currentUserId={currentUserId}
              onChanged={handleChanged}
              onDeleted={handleDeleted}
            />
          ))}
        </div>
      )}

      {data.totalPages > 1 && (
        <div className="flex justify-center">
          <KunPagination
            total={data.totalPages}
            page={data.page}
            onPageChange={handlePageChange}
            isLoading={fetching}
          />
        </div>
      )}
    </div>
  )
}
