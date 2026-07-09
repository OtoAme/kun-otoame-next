'use client'

import { useEffect, useState } from 'react'
import { Button, Input } from '@heroui/react'
import Link from 'next/link'
import toast from 'react-hot-toast'
import { kunFetchGet, kunFetchPost } from '~/utils/kunFetch'
import { FetchPreview } from '~/components/edit/components/FetchPreview'
import {
  applySteamOfficialUrlFallback,
  normalizeSteamIdInput,
  parseSteamIdInput,
  syncSteamOfficialUrl
} from '~/utils/externalIds'
import type { ClipboardEvent } from 'react'
import type {
  PatchFormDataSetter,
  PatchFormDataShape
} from '~/components/edit/types'

interface SteamPreview {
  name: string
  aliases: {
    english?: string
    japanese?: string
    tchinese?: string
  }
  releaseDate: string
  tags: string[]
  developers: { name: string; link: string }[]
}

interface Props<T extends PatchFormDataShape> {
  errors?: string
  data: T
  setData: PatchFormDataSetter<T>
  excludeId?: number
}

export const SteamInput = <T extends PatchFormDataShape>({
  errors,
  data,
  setData,
  excludeId
}: Props<T>) => {
  const [preview, setPreview] = useState<SteamPreview | null>(null)
  const [duplicateUniqueId, setDuplicateUniqueId] = useState<string | null>(
    null
  )

  useEffect(() => {
    setPreview(null)
    setDuplicateUniqueId(null)
  }, [data.steamId])

  const setSteamId = (steamId: string) => {
    setData((current) => ({
      ...current,
      steamId,
      officialUrl: syncSteamOfficialUrl(
        current.officialUrl,
        current.steamId,
        steamId
      )
    }))
  }

  const handleFetch = async () => {
    const rawInput = normalizeSteamIdInput(data.steamId)
    if (!rawInput) {
      toast.error('Steam ID 不可为空')
      return
    }

    if (!/^\d+$/.test(rawInput)) {
      toast.error('Steam ID 必须为纯数字')
      return
    }

    const duplicateResult = await kunFetchGet<
      KunResponse<{ uniqueId: string }>
    >('/edit/duplicate', {
      steamId: rawInput,
      ...(excludeId ? { excludeId: String(excludeId) } : {})
    })

    if (typeof duplicateResult !== 'string' && duplicateResult?.uniqueId) {
      setDuplicateUniqueId(duplicateResult.uniqueId)
      toast.error('发现相同 Steam ID 的已有游戏，请确认是否为合集或共用商店页')
    } else {
      setDuplicateUniqueId(null)
    }

    try {
      toast('正在从 Steam 获取数据...')
      const result = await kunFetchPost<KunResponse<SteamPreview>>(
        '/edit/steam',
        { steamId: rawInput }
      )

      if (typeof result === 'string') {
        toast.error(result)
        return
      }

      if (!result?.name) {
        toast.error('未找到对应的 Steam 游戏')
        return
      }

      setPreview(result)

      const extraAliases = [
        result.aliases.japanese,
        result.aliases.english,
        result.aliases.tchinese
      ]
        .map((alias) => alias?.trim())
        .filter((alias): alias is string => !!alias)
      setData((current) => ({
        ...current,
        steamId: rawInput,
        officialUrl: applySteamOfficialUrlFallback(
          current.officialUrl,
          rawInput
        ),
        alias: [...new Set([...current.alias, ...extraAliases])].filter(
          (alias) => alias !== current.name
        ),
        released: result.releaseDate || current.released,
        steamTags: result.tags,
        steamDevelopers: result.developers.map((developer) => developer.name),
        steamAliases: extraAliases
      }))

      toast.success(`确认: ${result.name}`)
    } catch {
      setPreview(null)
      toast.error('Steam API 请求失败, 请稍后重试')
    }
  }

  const handlePaste = (event: ClipboardEvent<HTMLInputElement>) => {
    const id = parseSteamIdInput(event.clipboardData.getData('text'))
    if (!id) {
      return
    }

    event.preventDefault()
    setSteamId(id)
  }

  const aliasChips = preview
    ? [
        preview.aliases.japanese,
        preview.aliases.english,
        preview.aliases.tchinese
      ].filter((alias): alias is string => !!alias?.trim())
    : []

  return (
    <div className="w-full space-y-2">
      <h2 className="text-xl">Steam ID (可选)</h2>
      <Input
        variant="underlined"
        labelPlacement="outside"
        placeholder="请输入 Steam App ID, 例如 3655150"
        value={data.steamId}
        onChange={(event) => setSteamId(event.target.value)}
        onPaste={handlePaste}
        isInvalid={!!errors}
        errorMessage={errors}
      />
      <div className="flex items-center gap-2 text-sm">
        {data.steamId && (
          <Button color="primary" size="sm" onPress={handleFetch}>
            获取 Steam 数据
          </Button>
        )}
        {duplicateUniqueId && (
          <Button
            as={Link}
            color="primary"
            target="_blank"
            href={`/${duplicateUniqueId}`}
            variant="flat"
            size="sm"
          >
            跳转到重复游戏
          </Button>
        )}
      </div>
      {preview && (
        <FetchPreview
          fields={[
            { label: '游戏名', value: preview.name },
            { label: '别名', value: aliasChips },
            { label: '标签', value: preview.tags },
            { label: '发售日期', value: preview.releaseDate },
            {
              label: '开发商',
              value: preview.developers.map((developer) => developer.name)
            }
          ]}
        />
      )}
    </div>
  )
}
