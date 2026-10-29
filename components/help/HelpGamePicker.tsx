'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { Autocomplete, AutocompleteItem } from '@heroui/react'
import { Chip } from '@heroui/chip'
import { Search } from 'lucide-react'
import { kunFetchPost } from '~/utils/kunFetch'
import type { HelpPatchLink } from '~/types/api/help'

const SEARCH_DEBOUNCE_MS = 300

interface Props {
  value: HelpPatchLink | null
  onChange: (patch: HelpPatchLink | null) => void
  isDisabled?: boolean
}

/**
 * Optional game link for a help post. It reuses the site search with the
 * same keyword query as the shoutbox game picker; the server checks the
 * picked entry again on submit.
 */
export const HelpGamePicker = ({ value, onChange, isDisabled }: Props) => {
  const [keyword, setKeyword] = useState('')
  const [results, setResults] = useState<GalgameCard[]>([])
  const [searching, setSearching] = useState(false)
  const seqRef = useRef(0)

  useEffect(() => {
    const seq = ++seqRef.current
    const query = keyword.trim()
    if (!query) {
      setResults([])
      setSearching(false)
      return
    }
    const timer = setTimeout(() => {
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
          if (seq !== seqRef.current) return
          setResults(
            typeof response === 'string' ? [] : (response.galgames ?? [])
          )
        })
        .catch(() => {
          if (seq === seqRef.current) setResults([])
        })
        .finally(() => {
          if (seq === seqRef.current) setSearching(false)
        })
    }, SEARCH_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [keyword])

  if (value) {
    return (
      <Chip
        variant="flat"
        onClose={isDisabled ? undefined : () => onChange(null)}
      >
        <Link href={`/${value.uniqueId}`} className="hover:underline">
          {value.name}
        </Link>
      </Chip>
    )
  }

  return (
    <Autocomplete
      fullWidth
      isClearable
      label="关联站内游戏"
      labelPlacement="outside"
      placeholder="搜索游戏名称"
      startContent={<Search className="size-4 text-default-400" />}
      inputValue={keyword}
      onInputChange={setKeyword}
      isLoading={searching}
      items={results}
      isDisabled={isDisabled}
      listboxProps={{ emptyContent: '没有找到匹配的游戏' }}
      onSelectionChange={(key) => {
        const game = results.find(
          (candidate) => String(candidate.id) === String(key)
        )
        if (!game) return
        onChange({ id: game.id, uniqueId: game.uniqueId, name: game.name })
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
  )
}
