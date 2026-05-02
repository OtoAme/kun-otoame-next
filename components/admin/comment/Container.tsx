'use client'

import {
  Autocomplete,
  AutocompleteItem,
  Avatar,
  Input,
  Select,
  SelectItem
} from '@heroui/react'
import { Search } from 'lucide-react'
import { useEffect, useState, type Key } from 'react'
import { kunFetchGet } from '~/utils/kunFetch'
import { KunLoading } from '~/components/kun/Loading'
import { useMounted } from '~/hooks/useMounted'
import { CommentCard } from './Card'
import { useDebounce } from 'use-debounce'
import { KunPagination } from '~/components/kun/Pagination'
import type { AdminComment, AdminUser } from '~/types/api/admin'

type AdminCommentSearchType = 'content' | 'user'

const searchTypeOptions: Array<{
  key: AdminCommentSearchType
  label: string
  placeholder: string
}> = [
  { key: 'content', label: '评论内容', placeholder: '输入评论内容搜索评论' },
  { key: 'user', label: '用户名', placeholder: '输入用户名搜索...' }
]

interface UserOption {
  id: number
  name: string
  avatar: string
}

interface Props {
  initialComments: AdminComment[]
  initialTotal: number
}

export const Comment = ({ initialComments, initialTotal }: Props) => {
  const [comments, setComments] = useState<AdminComment[]>(initialComments)
  const [total, setTotal] = useState(initialTotal)
  const [page, setPage] = useState(1)
  const [limit, setLimit] = useState(30)
  const [searchType, setSearchType] =
    useState<AdminCommentSearchType>('content')
  const [contentQuery, setContentQuery] = useState('')
  const [debouncedContent] = useDebounce(contentQuery, 500)
  const [userInput, setUserInput] = useState('')
  const [debouncedUserInput] = useDebounce(userInput, 400)
  const [userOptions, setUserOptions] = useState<UserOption[]>([])
  const [selectedUserId, setSelectedUserId] = useState<number | null>(null)
  const [userSearchLoading, setUserSearchLoading] = useState(false)
  const isMounted = useMounted()

  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!debouncedUserInput.trim()) {
      setUserOptions([])
      return
    }

    let cancelled = false

    const fetchUsers = async () => {
      setUserSearchLoading(true)
      try {
        const { users } = await kunFetchGet<{
          users: AdminUser[]
          total: number
        }>('/admin/user', {
          page: 1,
          limit: 10,
          search: debouncedUserInput,
          searchType: 'name'
        })

        if (!cancelled) {
          setUserOptions(
            users.map((user) => ({
              id: user.id,
              name: user.name,
              avatar: user.avatar
            }))
          )
        }
      } finally {
        if (!cancelled) {
          setUserSearchLoading(false)
        }
      }
    }

    fetchUsers()

    return () => {
      cancelled = true
    }
  }, [debouncedUserInput])

  const fetchData = async () => {
    setLoading(true)

    const params: Record<string, string | number> = {
      page,
      limit,
      searchType
    }
    if (searchType === 'content' && debouncedContent) {
      params.search = debouncedContent
    }
    if (searchType === 'user' && selectedUserId) {
      params.userId = selectedUserId
    }

    const { comments, total } = await kunFetchGet<{
      comments: AdminComment[]
      total: number
    }>('/admin/comment', params)

    setLoading(false)
    setComments(comments)
    setTotal(total)
  }

  useEffect(() => {
    if (!isMounted) {
      return
    }
    fetchData()
  }, [page, limit, searchType, debouncedContent, selectedUserId])

  const handleSearchTypeChange = (keys: 'all' | Set<Key>) => {
    const key = Array.from(keys)[0] as AdminCommentSearchType | undefined
    if (!key) {
      return
    }

    setSearchType(key)
    setPage(1)
    setContentQuery('')
    setUserInput('')
    setSelectedUserId(null)
    setUserOptions([])
  }

  const handleContentSearch = (value: string) => {
    setContentQuery(value)
    setPage(1)
  }

  const handleUserSelectionChange = (key: Key | null) => {
    setSelectedUserId(key ? Number(key) : null)
    setPage(1)
  }

  const handleUserInputChange = (value: string) => {
    setUserInput(value)
    if (!value) {
      setSelectedUserId(null)
      setPage(1)
    }
  }

  const currentPlaceholder =
    searchTypeOptions.find((option) => option.key === searchType)?.placeholder ??
    ''

  if (!isMounted) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold">评论管理</h1>
        <KunLoading hint="正在获取评论数据..." />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">评论管理</h1>

      <div className="flex flex-col gap-3 sm:flex-row">
        <Select
          aria-label="搜索类型"
          className="w-full sm:max-w-40"
          selectedKeys={new Set([searchType])}
          onSelectionChange={handleSearchTypeChange}
        >
          {searchTypeOptions.map((option) => (
            <SelectItem key={option.key}>{option.label}</SelectItem>
          ))}
        </Select>

        {searchType === 'user' ? (
          <Autocomplete
            fullWidth
            isClearable
            placeholder={currentPlaceholder}
            startContent={<Search className="text-default-300" size={20} />}
            inputValue={userInput}
            isLoading={userSearchLoading}
            items={userOptions}
            onInputChange={handleUserInputChange}
            onSelectionChange={handleUserSelectionChange}
          >
            {(user) => (
              <AutocompleteItem key={user.id} textValue={user.name}>
                <div className="flex items-center gap-2">
                  <Avatar
                    src={user.avatar}
                    size="sm"
                    showFallback
                    name={user.name.charAt(0).toUpperCase()}
                  />
                  <span>{user.name}</span>
                </div>
              </AutocompleteItem>
            )}
          </Autocomplete>
        ) : (
          <Input
            fullWidth
            isClearable
            placeholder={currentPlaceholder}
            startContent={<Search className="text-default-300" size={20} />}
            value={contentQuery}
            onValueChange={handleContentSearch}
          />
        )}
      </div>

      <div className="space-y-4">
        {loading ? (
          <KunLoading hint="正在获取评论数据..." />
        ) : (
          <>
            {comments.map((comment) => (
              <CommentCard key={comment.id} comment={comment} />
            ))}
          </>
        )}
      </div>

      <div className="flex flex-col items-center justify-center gap-4 sm:flex-row">
        <Select
          aria-label="每页显示数量"
          size="sm"
          className="w-20"
          selectedKeys={new Set([String(limit)])}
          onSelectionChange={(keys) => {
            const selected = Array.from(keys)[0]
            if (!selected) {
              return
            }
            setLimit(Number(selected))
            setPage(1)
          }}
        >
          <SelectItem key="30">30</SelectItem>
          <SelectItem key="50">50</SelectItem>
          <SelectItem key="100">100</SelectItem>
          <SelectItem key="500">500</SelectItem>
        </Select>
        <KunPagination
          total={Math.ceil(total / limit)}
          page={page}
          onPageChange={setPage}
          isLoading={loading}
        />
      </div>
    </div>
  )
}
