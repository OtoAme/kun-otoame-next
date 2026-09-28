'use client'

import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'

import { Button } from '~/components/dashboard/ui/button'
import { Input } from '~/components/dashboard/ui/input'
import { kunFetchPost } from '~/utils/kunFetch'

const SEARCH_DEBOUNCE_MS = 300
const SEARCH_LIMIT = 8

export interface CaseMovePatchOption {
  id: number
  uniqueId: string
  name: string
}

interface CaseMovePatchSearchProps {
  disabled?: boolean
  /** The resource's current game, which is never a valid destination. */
  excludePatchId?: number
  onPick: (patch: CaseMovePatchOption) => void
}

/**
 * Finds the destination game of a resource move by name (review item 16). It
 * reuses the site search with the keyword query of the shoutbox game picker,
 * so results follow the administrator's own content preferences; the numeric
 * ID field beside it remains for games the search does not show.
 */
export function CaseMovePatchSearch({
  disabled,
  excludePatchId,
  onPick
}: CaseMovePatchSearchProps) {
  const [keyword, setKeyword] = useState('')
  const [results, setResults] = useState<CaseMovePatchOption[]>([])
  const [searching, setSearching] = useState(false)
  const [searched, setSearched] = useState(false)
  const [error, setError] = useState('')
  const query = keyword.trim()

  useEffect(() => {
    let ignore = false
    setResults([])
    setSearched(false)
    setError('')
    setSearching(Boolean(query))
    if (!query) {
      return
    }
    const timer = setTimeout(() => {
      kunFetchPost<{ galgames?: GalgameCard[]; total: number } | string>(
        '/search',
        {
          queryString: JSON.stringify([
            { type: 'keyword', mode: 'include', name: query }
          ]),
          limit: SEARCH_LIMIT,
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
          if (ignore) return
          if (typeof response === 'string') {
            setError(response || '搜索失败，请稍后重试')
            return
          }
          setResults(
            (response.galgames ?? []).map((game) => ({
              id: game.id,
              uniqueId: game.uniqueId,
              name: game.name
            }))
          )
          setSearched(true)
        })
        .catch(() => {
          // kunFetch also throws on a non-string error body such as a 5xx.
          if (ignore) return
          setError('搜索失败，请稍后重试')
        })
        .finally(() => {
          if (!ignore) setSearching(false)
        })
    }, SEARCH_DEBOUNCE_MS)
    return () => {
      ignore = true
      clearTimeout(timer)
    }
  }, [query])

  const options = results.filter((patch) => patch.id !== excludePatchId)

  return (
    <div className="space-y-2">
      <label htmlFor="case-move-search" className="text-sm font-medium">
        按游戏名搜索目标条目
      </label>
      <div className="relative">
        <Input
          id="case-move-search"
          autoComplete="off"
          value={keyword}
          onChange={(event) => setKeyword(event.target.value)}
          disabled={disabled}
          placeholder="输入游戏名或别名"
        />
        {searching ? (
          <Loader2
            className="absolute top-1/2 right-2 size-4 -translate-y-1/2 animate-spin text-muted-foreground"
            aria-hidden
          />
        ) : null}
      </div>
      {error ? (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      ) : options.length ? (
        <ul className="divide-y rounded-md border" aria-label="搜索结果">
          {options.map((patch) => (
            <li key={patch.id}>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-auto w-full justify-start px-3 py-2 text-left whitespace-normal"
                disabled={disabled}
                onClick={() => {
                  onPick(patch)
                  setKeyword('')
                }}
              >
                <span className="min-w-0 break-words">{patch.name}</span>
                <span className="ml-auto shrink-0 text-xs tabular-nums text-muted-foreground">
                  #{patch.id}
                </span>
              </Button>
            </li>
          ))}
        </ul>
      ) : searched && !searching ? (
        <p className="text-xs text-muted-foreground">
          没有找到匹配的游戏；搜索结果受你自己的内容显示设置影响，也可以直接填写条目
          ID。
        </p>
      ) : null}
    </div>
  )
}
