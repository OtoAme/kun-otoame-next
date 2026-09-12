'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { Autocomplete, AutocompleteItem } from '@heroui/react'
import { Button } from '@heroui/button'
import { Chip } from '@heroui/chip'
import { Textarea } from '@heroui/input'
import { Search } from 'lucide-react'
import toast from 'react-hot-toast'
import { SHOUTBOX_PRICE } from '~/constants/shoutbox'
import { useUserStore } from '~/store/userStore'
import { kunFetchPost } from '~/utils/kunFetch'
import { generateUUID } from '~/utils/random'
import { normalizeShoutboxContent } from '~/utils/shoutboxContent'
import type {
  ShoutboxItem,
  ShoutboxPublishResponse
} from '~/types/api/shoutbox'

export interface ShoutboxPickedPatch {
  id: number
  uniqueId: string
  name: string
}

interface Props {
  presetPatch?: ShoutboxPickedPatch | null
  /**
   * Patch-mode pages pass true together with presetPatch once the current
   * game's summary is known: the association is preselected and locked to
   * that game. Without a known preset, the form stays the normal optional
   * search and never claims a preselection.
   */
  lockPatchSelection?: boolean
  onPublished: (item: ShoutboxItem) => void
}

const SEARCH_DEBOUNCE_MS = 500

export const ShoutboxPublishForm = ({
  presetPatch = null,
  lockPatchSelection = false,
  onPublished
}: Props) => {
  const [content, setContent] = useState('')
  const [contentError, setContentError] = useState('')
  const [selectedPatch, setSelectedPatch] =
    useState<ShoutboxPickedPatch | null>(presetPatch)
  const [keyword, setKeyword] = useState('')
  const [searching, setSearching] = useState(false)
  const [results, setResults] = useState<GalgameCard[]>([])
  const [requestId, setRequestId] = useState(() => generateUUID())
  const [submitting, setSubmitting] = useState(false)
  const submitLockRef = useRef(false)
  const searchSeqRef = useRef(0)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const available = useUserStore((state) => state.user.moemoepointAvailable)
  const setMoemoepointBalance = useUserStore(
    (state) => state.setMoemoepointBalance
  )
  const insufficient = available < SHOUTBOX_PRICE

  // Optional game association: keyword search reuses the existing /api/search
  // endpoint; the picked entry supplies the numeric patch id for publishing.
  // Every effect run (each keystroke, including clearing the input) bumps the
  // sequence FIRST and the scheduled request captures it, so a response that
  // resolves during a later debounce window can never refill stale results.
  useEffect(() => {
    const seq = ++searchSeqRef.current
    const query = keyword.trim()
    if (!query) {
      setResults([])
      setSearching(false)
      return
    }
    if (debounceRef.current !== null) {
      clearTimeout(debounceRef.current)
    }
    debounceRef.current = setTimeout(() => {
      debounceRef.current = null
      setSearching(true)
      kunFetchPost<KunResponse<{ galgames: GalgameCard[]; total: number }>>(
        '/search',
        {
          queryString: JSON.stringify([
            { type: 'keyword', mode: 'include', name: query }
          ]),
          limit: 5,
          searchOption: {
            searchInIntroduction: false,
            searchInAlias: true,
            searchInTag: false
          },
          page: 1,
          selectedType: 'all',
          selectedLanguage: 'all',
          selectedPlatform: 'all',
          sortField: 'created',
          sortOrder: 'desc',
          selectedYears: ['all'],
          selectedMonths: ['all'],
          minRatingCount: 0
        }
      )
        .then((response) => {
          if (seq !== searchSeqRef.current) {
            return
          }
          setResults(
            typeof response === 'string' ? [] : (response.galgames ?? [])
          )
        })
        .catch(() => {
          if (seq !== searchSeqRef.current) {
            return
          }
          setResults([])
        })
        .finally(() => {
          if (seq === searchSeqRef.current) {
            setSearching(false)
          }
        })
    }, SEARCH_DEBOUNCE_MS)
    return () => {
      if (debounceRef.current !== null) {
        clearTimeout(debounceRef.current)
        debounceRef.current = null
      }
    }
  }, [keyword])

  const handleSubmit = async () => {
    const trimmed = content.trim()
    if (!trimmed) {
      setContentError('小喇叭正文不能为空')
      return
    }
    if (trimmed.length > 200) {
      setContentError('小喇叭正文不能超过 200 个字符')
      return
    }
    if (insufficient) {
      toast.error(`可用萌萌点不足 ${SHOUTBOX_PRICE} 点，无法发布`)
      return
    }
    if (submitLockRef.current) {
      return
    }
    submitLockRef.current = true
    setSubmitting(true)
    try {
      const response = await kunFetchPost<KunResponse<ShoutboxPublishResponse>>(
        '/shoutbox',
        {
          requestId,
          content: trimmed,
          ...(selectedPatch ? { patchId: selectedPatch.id } : {})
        }
      )
      if (typeof response === 'string') {
        // Business refusal: no charge happened; keep the draft and requestId.
        toast.error(response)
        return
      }
      // The authoritative balance comes straight from the publish response:
      // a replayed request (same requestId after a lost response) reports the
      // server's real balance instead of letting the UI decrement twice.
      setMoemoepointBalance(response.moemoepointBalance)
      toast.success('小喇叭已发布')
      setContent('')
      setContentError('')
      setKeyword('')
      setResults([])
      setSelectedPatch(presetPatch)
      setRequestId(generateUUID())
      onPublished(response)
    } catch {
      // Result unknown (network/timeout): keep the draft AND the same
      // requestId so pressing publish again retries the original request
      // instead of creating a second one.
      toast.error('发布结果未知，请稍后重试；重试不会重复扣费')
    } finally {
      submitLockRef.current = false
      setSubmitting(false)
    }
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-default-500">
        小喇叭不可回复；需要他人回应的内容请使用求助区或投稿
      </p>
      <Textarea
        aria-label="小喇叭正文"
        placeholder="用一句话和大家说点什么吧"
        value={content}
        onValueChange={(value) => {
          setContent(normalizeShoutboxContent(value))
          setContentError('')
        }}
        maxLength={200}
        minRows={3}
        isDisabled={submitting}
        isInvalid={contentError !== ''}
        errorMessage={contentError}
        autoFocus
      />
      <div className="flex items-center justify-between text-xs text-default-400">
        <span>发布后 5 分钟内可编辑一次</span>
        <span>{content.trim().length} / 200</span>
      </div>

      <div className="space-y-2">
        <p className="text-xs text-default-500">关联一个游戏（可选）</p>
        {selectedPatch ? (
          <div className="flex items-center gap-2">
            <Chip
              onClose={
                lockPatchSelection ? undefined : () => setSelectedPatch(null)
              }
              variant="flat"
            >
              <Link
                href={`/${selectedPatch.uniqueId}`}
                className="hover:underline"
              >
                {selectedPatch.name}
              </Link>
            </Chip>
            {lockPatchSelection && (
              <span className="text-xs text-default-400">将关联到当前游戏</span>
            )}
          </div>
        ) : (
          <Autocomplete
            fullWidth
            isClearable
            aria-label="搜索要关联的游戏"
            placeholder="搜索游戏名称"
            startContent={<Search className="size-4 text-default-400" />}
            inputValue={keyword}
            onInputChange={setKeyword}
            isLoading={searching}
            items={results}
            isDisabled={submitting}
            listboxProps={{ emptyContent: '没有找到匹配的游戏' }}
            onSelectionChange={(key) => {
              const game = results.find(
                (candidate) => String(candidate.id) === String(key)
              )
              if (!game) {
                return
              }
              setSelectedPatch({
                id: game.id,
                uniqueId: game.uniqueId,
                name: game.name
              })
              setKeyword('')
              setResults([])
            }}
          >
            {(game) => (
              <AutocompleteItem key={game.id} textValue={game.name}>
                <span className="text-sm">{game.name}</span>
              </AutocompleteItem>
            )}
          </Autocomplete>
        )}
      </div>

      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-default-500">
          发布需消耗 {SHOUTBOX_PRICE} 萌萌点（当前可用 {available} 点）
        </p>
        <Button
          color="primary"
          onPress={handleSubmit}
          isLoading={submitting}
          isDisabled={insufficient}
        >
          发布小喇叭
        </Button>
      </div>
      {insufficient && (
        <p className="text-xs text-danger" role="alert">
          可用萌萌点不足 {SHOUTBOX_PRICE} 点，暂时无法发布小喇叭
        </p>
      )}
    </div>
  )
}
