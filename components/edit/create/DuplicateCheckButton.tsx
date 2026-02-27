'use client'

import { useState } from 'react'
import { Button } from '@heroui/react'
import toast from 'react-hot-toast'
import Link from 'next/link'
import { useCreatePatchStore } from '~/store/editStore'
import { kunFetchGet } from '~/utils/kunFetch'

interface DuplicateItem {
  uniqueId: string
  name: string
}

interface DuplicateResponse {
  uniqueId: string
  matchedFields?: string[]
  duplicates?: DuplicateItem[]
}

const fieldLabels: Record<string, string> = {
  vndbRelationId: 'Release ID',
  dlsiteCode: 'DLsite Code',
  vndbId: 'VNDB ID',
  title: '游戏标题/别名'
}

export const DuplicateCheckButton = () => {
  const { data } = useCreatePatchStore()
  const [checking, setChecking] = useState(false)
  const [duplicateUniqueId, setDuplicateUniqueId] = useState<string | null>(
    null
  )
  const [duplicateList, setDuplicateList] = useState<DuplicateItem[]>([])
  const [matchedInfo, setMatchedInfo] = useState<string>('')

  const buildPayload = () => ({
    vndbId: (data.vndbId ?? '').trim().toLowerCase(),
    vndbRelationId: (data.vndbRelationId ?? '').trim().toLowerCase(),
    dlsiteCode: (data.dlsiteCode ?? '').trim().toUpperCase(),
    title: (data.name ?? '').trim()
  })

  const handleCheckDuplicate = async () => {
    const payload = buildPayload()

    if (
      !payload.vndbId &&
      !payload.vndbRelationId &&
      !payload.dlsiteCode &&
      !payload.title
    ) {
      toast.error('请至少填写一个可用的查重字段')
      return
    }

    setChecking(true)
    setDuplicateUniqueId(null)
    setDuplicateList([])
    setMatchedInfo('')
    try {
      const response = await kunFetchGet<KunResponse<DuplicateResponse>>(
        '/edit/duplicate',
        {
          vndbId: payload.vndbId,
          vndbRelationId: payload.vndbRelationId,
          dlsiteCode: payload.dlsiteCode,
          title: payload.title
        }
      )

      if (typeof response === 'string') {
        toast.error(response)
        return
      }

      if (response?.uniqueId) {
        setDuplicateUniqueId(response.uniqueId)
        const list = response.duplicates || [
          { uniqueId: response.uniqueId, name: '' }
        ]
        setDuplicateList(list)
        const fields = response.matchedFields || []
        const labels = fields.map((f) => fieldLabels[f] || f).join(', ')
        setMatchedInfo(labels)

        const hasHardDuplicate = fields.some(
          (f) => f === 'vndbRelationId' || f === 'dlsiteCode'
        )
        if (hasHardDuplicate) {
          toast.error(`发现不可重复的字段匹配 (${labels})`)
        } else {
          toast.error(`发现重复记录 (匹配: ${labels}), 仅 VNDB ID 重复可确认后发布`)
        }
      } else {
        toast.success('检查完成, 未找到重复游戏')
      }
    } catch (error) {
      console.error(error)
      toast.error('查重失败, 请稍后再试')
    } finally {
      setChecking(false)
    }
  }

  return (
    <div className="flex w-full flex-col gap-2 sm:flex-row sm:items-center">
      <Button
        color="secondary"
        size="sm"
        onPress={handleCheckDuplicate}
        isDisabled={checking}
        isLoading={checking}
      >
        检查重复
      </Button>

      {duplicateUniqueId && (
        <>
          <div className="flex flex-wrap gap-2">
            {duplicateList.map((item) => (
              <Button
                key={item.uniqueId}
                as={Link}
                color="primary"
                target="_blank"
                href={`/${item.uniqueId}`}
                variant="flat"
                size="sm"
              >
                {item.name || item.uniqueId}
              </Button>
            ))}
          </div>
          {matchedInfo && (
            <span className="text-sm text-default-500">
              匹配字段: {matchedInfo}
            </span>
          )}
        </>
      )}
    </div>
  )
}
