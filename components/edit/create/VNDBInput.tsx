'use client'

import { useState } from 'react'
import { Button, Checkbox, Input } from '@heroui/react'
import toast from 'react-hot-toast'
import { fetchVNDBDetails } from '~/utils/vndb'
import { kunFetchGet } from '~/utils/kunFetch'
import type { PatchFormDataShape } from '~/components/edit/types'

interface DuplicateItem {
  uniqueId: string
  name: string
}

interface DuplicateResponse {
  uniqueId: string
  matchedFields?: string[]
  duplicates?: DuplicateItem[]
}

interface Props<T extends PatchFormDataShape> {
  errors: string | undefined
  data: T
  setData: (data: T) => void
  isDuplicate?: boolean
  onDuplicateChange?: (value: boolean) => void
}

export const VNDBInput = <T extends PatchFormDataShape>({
  errors,
  data,
  setData,
  isDuplicate = false,
  onDuplicateChange
}: Props<T>) => {
  const [duplicateFound, setDuplicateFound] = useState(false)
  const [duplicateList, setDuplicateList] = useState<DuplicateItem[]>([])

  const handleFetchData = async () => {
    const rawInput = (data.vndbId ?? '').trim()
    if (!rawInput) {
      toast.error('VNDB ID 不可为空')
      return
    }

    const normalizedInput = rawInput.toLowerCase()
    if (!/^v\d+$/.test(normalizedInput)) {
      toast.error('VNDB ID 需要以 v 开头')
      return
    }

    // Check duplicate first
    try {
      const duplicateResult = await kunFetchGet<
        KunResponse<DuplicateResponse>
      >('/edit/duplicate', { vndbId: normalizedInput })

      if (
        typeof duplicateResult !== 'string' &&
        duplicateResult?.uniqueId &&
        duplicateResult.matchedFields?.includes('vndbId')
      ) {
        const list = duplicateResult.duplicates || [
          { uniqueId: duplicateResult.uniqueId, name: '' }
        ]
        setDuplicateFound(true)
        setDuplicateList(list)
        toast.error(
          `该 VNDB ID 已有 ${list.length} 个游戏存在, 如需发布不同版本请勾选确认`
        )
      } else {
        setDuplicateFound(false)
        setDuplicateList([])
        onDuplicateChange?.(false)
      }
    } catch {
      // Non-fatal, continue with fetch
    }

    // Fetch VNDB data regardless
    try {
      toast('正在从 VNDB 获取数据...')
      const { titles, released } = await fetchVNDBDetails(normalizedInput)

      setData({
        ...data,
        vndbId: normalizedInput,
        alias: [...new Set(titles)],
        released: released || data.released
      })

      toast.success('获取数据成功! 已为您自动添加游戏别名')
    } catch (error) {
      console.error(error)
      if (
        error instanceof Error &&
        (error.message === 'VNDB_API_ERROR' ||
          error.message === 'VNDB_NOT_FOUND')
      ) {
        const message =
          error.message === 'VNDB_NOT_FOUND'
            ? '未找到对应的 VNDB 数据'
            : 'VNDB API 请求失败, 请稍后重试'
        toast.error(message)
      } else {
        toast.error('VNDB API 请求失败, 请稍后重试')
      }
    }
  }

  return (
    <div className="w-full space-y-2">
      <h2 className="text-xl">VNDB ID (可选)</h2>
      <Input
        variant="underlined"
        labelPlacement="outside"
        placeholder="请输入 VNDB ID, 例如 v19658"
        value={data.vndbId}
        onChange={(e) => setData({ ...data, vndbId: e.target.value })}
        isInvalid={!!errors}
        errorMessage={errors}
      />
      <p className="text-sm">
        提示: VNDB ID 需要 VNDB 官网 (vndb.org)
        获取，当进入对应游戏的页面，游戏页面的 URL (形如
        https://vndb.org/v19658) 中的 v19658 就是 VNDB ID
      </p>
      <p className="text-sm text-default-500">
        我们强烈建议您填写 VNDB ID 以确保游戏不重复, 获取 VNDB ID
        将会自动生成游戏发售日期与游戏别名
      </p>
      <p className="text-sm text-default-500">
        <b>您可以不填写 VNDB ID 发布游戏, 但是您需要自行检查游戏是否重复</b>
      </p>
      <div className="flex flex-col gap-2">
        <div className="flex items-center text-sm">
          {data.vndbId && (
            <Button
              className="mr-4"
              color="primary"
              size="sm"
              onPress={handleFetchData}
            >
              获取 VNDB 数据
            </Button>
          )}
        </div>
        {duplicateFound && (
          <div className="flex flex-col gap-2">
            <Checkbox
              size="sm"
              isSelected={isDuplicate}
              onValueChange={(value) => onDuplicateChange?.(value)}
            >
              <span className="text-sm text-warning-600">
                确认 VNDB ID 重复, 发布不同版本
              </span>
            </Checkbox>
            <div className="flex flex-wrap gap-2">
              {duplicateList.map((item) => (
                <a
                  key={item.uniqueId}
                  href={`/${item.uniqueId}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm text-primary underline"
                >
                  {item.name || item.uniqueId}
                </a>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
