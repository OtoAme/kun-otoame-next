'use client'

import { useEffect, useState } from 'react'
import type { FormEvent, RefObject } from 'react'
import { Keyboard, RefreshCw, Search } from 'lucide-react'

import { Button } from '~/components/dashboard/ui/button'
import { Checkbox } from '~/components/dashboard/ui/checkbox'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger
} from '~/components/dashboard/ui/dialog'
import { Input } from '~/components/dashboard/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '~/components/dashboard/ui/select'
import { INBOX_KIND_LABELS } from '~/constants/dashboard'
import {
  INBOX_SEARCH_MAX,
  type UseInboxReturn
} from '~/hooks/dashboard/useInbox'
import { cn } from '~/lib/dashboard/utils'
import { INBOX_KINDS, type InboxOrder } from '~/types/api/inbox'

export interface InboxToolbarProps {
  inbox: UseInboxReturn
  searchRef: RefObject<HTMLInputElement | null>
  helpOpen: boolean
  onHelpOpenChange: (open: boolean) => void
}

const SHORTCUTS: Array<{ keys: string; description: string }> = [
  { keys: '↑ / ↓', description: '在列表中选择事项' },
  { keys: 'Enter', description: '打开选中事项并聚焦右侧详情' },
  { keys: 'A', description: '触发当前详情中的「通过」操作' },
  {
    keys: 'D',
    description:
      '触发当前详情的危险操作：资源申请「拒绝并删除」、投稿「违规处理」，均会先进入一次确认'
  },
  { keys: '/', description: '聚焦搜索框' },
  { keys: '?', description: '打开本帮助' }
]

export function InboxToolbar({
  inbox,
  searchRef,
  helpOpen,
  onHelpOpenChange
}: InboxToolbarProps) {
  const {
    kinds,
    search,
    order,
    refreshing,
    toggleKind,
    setOrder,
    submitSearch,
    refreshAll
  } = inbox
  const [searchText, setSearchText] = useState(search)

  // Reflect the URL-driven search value (back/forward navigation) in the input.
  useEffect(() => {
    setSearchText(search)
  }, [search])

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    submitSearch(searchText)
  }

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b px-3 py-2">
      <form
        role="search"
        onSubmit={handleSubmit}
        className="flex min-w-[10rem] flex-1 items-center gap-2"
      >
        <label htmlFor="inbox-search" className="sr-only">
          搜索待办事项
        </label>
        <Input
          id="inbox-search"
          ref={searchRef}
          type="search"
          autoComplete="off"
          value={searchText}
          onChange={(event) => setSearchText(event.target.value)}
          maxLength={INBOX_SEARCH_MAX}
          placeholder="搜索待办事项"
          className="h-8 min-w-0 flex-1"
        />
        <Button type="submit" variant="secondary" size="sm">
          <Search className="size-4" aria-hidden />
          搜索
        </Button>
      </form>

      <fieldset className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <legend className="sr-only">来源筛选</legend>
        {INBOX_KINDS.map((kind) => {
          const checked = kinds.includes(kind)
          const isLastChecked = checked && kinds.length === 1
          return (
            <label
              key={kind}
              className="flex select-none items-center gap-1.5 text-sm"
              title={isLastChecked ? '至少保留一个来源' : undefined}
            >
              <Checkbox
                checked={checked}
                disabled={isLastChecked}
                onCheckedChange={(value) => toggleKind(kind, value === true)}
                aria-label={INBOX_KIND_LABELS[kind]}
              />
              {INBOX_KIND_LABELS[kind]}
            </label>
          )
        })}
      </fieldset>

      <Select
        value={order}
        onValueChange={(value) => setOrder(value as InboxOrder)}
      >
        <SelectTrigger aria-label="排序方式" className="h-8 w-[9.5rem]">
          <SelectValue placeholder="排序方式" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="waiting">等待最久优先</SelectItem>
          <SelectItem value="kind">按来源分组</SelectItem>
        </SelectContent>
      </Select>

      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={refreshing}
        onClick={() => {
          void refreshAll()
        }}
      >
        <RefreshCw
          className={cn('size-4', refreshing && 'animate-spin')}
          aria-hidden
        />
        刷新
      </Button>

      <Dialog open={helpOpen} onOpenChange={onHelpOpenChange}>
        <DialogTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-label="键盘快捷键帮助"
          >
            <Keyboard className="size-4" aria-hidden />
            快捷键
          </Button>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>键盘快捷键</DialogTitle>
            <DialogDescription>
              焦点在输入框、下拉框或可编辑区域时，以及有弹窗打开时，快捷键不生效。
            </DialogDescription>
          </DialogHeader>
          <dl className="space-y-2 text-sm">
            {SHORTCUTS.map((shortcut) => (
              <div
                key={shortcut.keys}
                className="flex items-center justify-between gap-4"
              >
                <dt>
                  <kbd className="rounded border bg-muted px-1.5 py-0.5 text-xs">
                    {shortcut.keys}
                  </kbd>
                </dt>
                <dd className="flex-1 text-right text-muted-foreground">
                  {shortcut.description}
                </dd>
              </div>
            ))}
          </dl>
          <div className="space-y-1 text-sm text-muted-foreground">
            <p>「旧反馈」「旧举报」为只读来源，请前往旧后台处理。</p>
            <p>
              驳回资源申请、按违规处理投稿等操作不可撤销，执行前会先要求确认。
            </p>
          </div>
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="secondary">
                关闭
              </Button>
            </DialogClose>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
