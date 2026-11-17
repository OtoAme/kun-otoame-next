'use client'
import { useEffect, useState } from 'react'
import { Card, CardBody, CardHeader } from '@heroui/card'
import { Chip } from '@heroui/chip'
import { Input } from '@heroui/input'
import { Button } from '@heroui/button'
import { useDebounce } from 'use-debounce'
import { useAccountPreferences } from '~/hooks/useAccountPreferences'
import { useUserStore } from '~/store/userStore'
import { editPreference, refreshPreferences } from '~/utils/preferenceClient'
import { kunFetchGet, kunFetchPost } from '~/utils/kunFetch'
import { PreferenceActions } from './PreferenceActions'
import type { Tag } from '~/types/api/tag'

export const BlockedTags = () => {
  const state = useAccountPreferences()
  const [query, setQuery] = useState('')
  const [debounced] = useDebounce(query, 300)
  const [tags, setTags] = useState<Record<number, Tag>>({})
  const [results, setResults] = useState<Tag[]>([])
  const [error, setError] = useState<string | null>(null)
  const uid = state.snapshot?.uid
  const context = state.snapshot?.context
  const version = state.snapshot?.version
  useEffect(() => {
    setResults([])
    setQuery('')
    setTags({})
  }, [uid, context])
  useEffect(() => {
    if (!uid || !context) return
    let ignore = false
    kunFetchGet<KunResponse<Tag[]>>('/user/setting/blocked-tag')
      .then((response) => {
        if (ignore) return
        if (typeof response === 'string') setError(response)
        else
          setTags((current) => ({
            ...current,
            ...Object.fromEntries(response.map((tag) => [tag.id, tag]))
          }))
      })
      .catch(() => {
        if (!ignore) setError('标签读取失败，请重试')
      })
    return () => {
      ignore = true
    }
  }, [uid, context, version])
  useEffect(() => {
    if (!uid || !debounced.trim()) {
      setResults([])
      return
    }
    let ignore = false
    kunFetchPost<KunResponse<Tag[]>>('/tag/search', {
      query: debounced.trim().split(/\s+/).slice(0, 10)
    })
      .then((response) => {
        if (ignore) return
        if (typeof response === 'string') setError(response)
        else {
          setResults(response)
          setTags((current) => ({
            ...current,
            ...Object.fromEntries(response.map((tag) => [tag.id, tag]))
          }))
        }
      })
      .catch(() => {
        if (!ignore) setError('标签搜索失败，请重试')
      })
    return () => {
      ignore = true
    }
  }, [uid, context, debounced])
  const blocked = new Set(state.snapshot?.blockedTagIds ?? [])
  for (const draft of Object.values(state.drafts))
    if (draft.key.startsWith('blocked-tag:')) {
      if (draft.value) blocked.add(Number(draft.key.slice(12)))
      else blocked.delete(Number(draft.key.slice(12)))
    }
  const choose = async (tagId: number, enabled: boolean) => {
    const session = useUserStore.getState()
    const expected = {
      context: session.sessionContext,
      generation: session.sessionGeneration
    }
    await refreshPreferences([tagId])
    const current = useUserStore.getState()
    if (
      current.sessionContext !== expected.context ||
      current.sessionGeneration !== expected.generation
    )
      return
    editPreference(`blocked-tag:${tagId}`, enabled)
  }
  return (
    <Card className="w-full text-sm">
      <CardHeader>
        <h2 className="text-xl font-medium">标签屏蔽</h2>
      </CardHeader>
      <CardBody className="space-y-4">
        <p>屏蔽标签后，带有该标签的游戏将从公开浏览结果中隐藏。</p>
        {!state.snapshot ? (
          <p role="status">正在确认账号偏好…</p>
        ) : (
          <>
            <Input
              aria-label="搜索屏蔽标签"
              placeholder="搜索标签名称"
              value={query}
              onValueChange={setQuery}
              isDisabled={!state.canEdit}
            />
            <div className="flex flex-wrap gap-2">
              {results
                .filter((tag) => !blocked.has(tag.id))
                .map((tag) => (
                  <Button
                    key={tag.id}
                    size="sm"
                    isDisabled={!state.canEdit}
                    onPress={() => {
                      void choose(tag.id, true)
                    }}
                  >
                    {tag.name}
                  </Button>
                ))}
            </div>
            <div className="flex flex-wrap gap-2">
              {[...blocked].map((id) => (
                <Chip
                  key={id}
                  color="danger"
                  variant="flat"
                  isDisabled={!state.canEdit}
                  onClose={() => {
                    void choose(id, false)
                  }}
                >
                  {tags[id]?.name ?? `标签 ${id}`}
                </Chip>
              ))}
            </div>
            {!blocked.size && <p>您暂时没有屏蔽任何标签</p>}
          </>
        )}
        {error && <p role="status">{error}</p>}
        <PreferenceActions />
      </CardBody>
    </Card>
  )
}
