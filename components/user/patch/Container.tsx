'use client'

import { useEffect, useState } from 'react'
import { kunFetchGet } from '~/utils/kunFetch'
import { KunPagination } from '~/components/kun/Pagination'
import { KunLoading } from '~/components/kun/Loading'
import { KunNull } from '~/components/kun/Null'
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

  const fetchPatches = async () => {
    setLoading(true)
    const response = await kunFetchGet<{
      galgames: GalgameCard[]
      total: number
    }>('/user/profile/patch', { uid, page, limit: 20 })
    setPatches(response.galgames)
    setLoading(false)
  }

  useEffect(() => {
    if (page === 1) {
      setPatches(galgames)
      return
    }
    fetchPatches()
  }, [page, galgames, uid])

  return (
    <div className="space-y-4">
      {loading ? (
        <KunLoading hint="正在获取发布的条目..." />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {patches.map((patch) => (
            <GalgameCard key={patch.id} patch={patch} />
          ))}
        </div>
      )}

      {!total && <KunNull message="这个孩子还没有发布过条目哦" />}

      {total > 20 && (
        <div className="flex justify-center">
          <KunPagination
            total={Math.ceil(total / 20)}
            page={page}
            onPageChange={setPage}
            isLoading={loading}
          />
        </div>
      )}
    </div>
  )
}
