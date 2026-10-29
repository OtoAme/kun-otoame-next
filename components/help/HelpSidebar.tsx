'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Button } from '@heroui/button'
import { Card, CardBody, CardHeader } from '@heroui/card'
import { Divider } from '@heroui/divider'
import { Listbox, ListboxItem } from '@heroui/listbox'
import { ChevronRight, Plus } from 'lucide-react'
import {
  HELP_ANSWER_REWARD,
  HELP_CATEGORIES,
  HELP_CATEGORY_LABELS,
  HELP_DAILY_POST_LIMIT,
  HELP_POST_FEE,
  HELP_STATUS_LABELS,
  type HelpCategory,
  type HelpScope,
  type HelpStatus
} from '~/constants/help'
import { useMounted } from '~/hooks/useMounted'
import { useUserStore } from '~/store/userStore'
import { kunFetchGet } from '~/utils/kunFetch'
import { HelpStatusChip } from './HelpStatusChip'
import type { HelpSidebarItem, HelpSidebarResponse } from '~/types/api/help'

export type HelpCategoryFilter = HelpCategory | 'all'

interface Props {
  /** List page: the active category and how to change it. */
  category?: HelpCategoryFilter
  onCategoryChange?: (category: HelpCategoryFilter) => void
  /** List page: category counts follow the scope and status tab. */
  status?: HelpStatus
  scope?: HelpScope
}

/**
 * The latest few own or followed posts, one line each, with the full count
 * in the header; 查看全部 opens the list filtered to that scope.
 */
const MyList = ({
  title,
  scope,
  list,
  empty,
  active
}: {
  title: string
  scope: Exclude<HelpScope, 'all'>
  list: { items: HelpSidebarItem[]; total: number }
  empty: string
  active?: boolean
}) => (
  <Card shadow="sm">
    <CardHeader className="justify-between gap-2 pb-1 text-sm font-medium">
      <span>
        {title}
        {list.total > 0 && (
          <span className="ml-1 text-xs font-normal text-default-400">
            {list.total}
          </span>
        )}
      </span>
      {list.total > 0 && !active && (
        <Link
          href={`/help?scope=${scope}`}
          className="inline-flex items-center text-xs font-normal text-default-500 hover:text-primary"
        >
          查看全部
          <ChevronRight className="size-3.5" aria-hidden />
        </Link>
      )}
    </CardHeader>
    <CardBody className="gap-1.5 pt-1">
      {list.items.length === 0 ? (
        <p className="text-xs text-default-400">{empty}</p>
      ) : (
        list.items.map((item) => (
          <Link
            key={item.id}
            href={`/help/${item.id}`}
            title={item.title}
            className="flex min-w-0 items-center gap-2 text-sm hover:text-primary"
          >
            <HelpStatusChip status={item.status} />
            <span className="truncate">{item.title}</span>
          </Link>
        ))
      )}
    </CardBody>
  </Card>
)

/**
 * Forum-style sidebar: category navigation with counts, the publish entry
 * with the fee rules, and the reader's own and followed posts. Category
 * links navigate to the list when the page has no local filter.
 */
export const HelpSidebar = ({
  category,
  onCategoryChange,
  status,
  scope = 'all'
}: Props) => {
  const mounted = useMounted()
  const uid = useUserStore((state) => state.user.uid)
  const [data, setData] = useState<HelpSidebarResponse | null>(null)

  useEffect(() => {
    if (!mounted) return
    let ignore = false
    kunFetchGet<HelpSidebarResponse | string>('/help/sidebar', {
      ...(status ? { status } : {}),
      scope
    })
      .then((value) => {
        if (!ignore && typeof value !== 'string') setData(value)
      })
      .catch(() => undefined)
    return () => {
      ignore = true
    }
  }, [mounted, uid, status, scope])

  const keys: HelpCategoryFilter[] = ['all', ...HELP_CATEGORIES]
  const countOf = (key: HelpCategoryFilter) =>
    data ? (key === 'all' ? data.total : data.categoryCounts[key]) : null

  return (
    <aside className="space-y-4" aria-label="求助区侧边栏">
      <Card shadow="sm">
        <CardBody className="gap-3">
          <Button
            as={Link}
            href="/help/create"
            color="primary"
            fullWidth
            startContent={<Plus className="size-4" />}
          >
            发布求助
          </Button>
          <ul className="space-y-1 text-xs text-default-500">
            <li>
              发帖费 {HELP_POST_FEE}{' '}
              萌萌点，发布成功才扣；删帖、被隐藏或没人回答都不退
            </li>
            <li>每人每天最多发 {HELP_DAILY_POST_LIMIT} 条</li>
            <li>
              第一次采纳合格回答时，系统给回答者 {HELP_ANSWER_REWARD}{' '}
              萌萌点（双方需注册满 7 天）
            </li>
            <li>由社区自愿回答，不保证回应</li>
          </ul>
        </CardBody>
      </Card>

      <Card shadow="sm" className="hidden lg:flex">
        <CardHeader className="justify-between pb-1 text-sm font-medium">
          <span>分类</span>
          {status && (
            <span className="text-xs font-normal text-default-400">
              计数：{HELP_STATUS_LABELS[status]}
            </span>
          )}
        </CardHeader>
        <Divider />
        <CardBody className="p-1">
          <Listbox
            aria-label="求助分类"
            selectionMode="single"
            disallowEmptySelection
            selectedKeys={category ? [category] : []}
            onSelectionChange={(selection) => {
              const key = Array.from(selection)[0] as
                | HelpCategoryFilter
                | undefined
              if (key && onCategoryChange) onCategoryChange(key)
            }}
          >
            {keys.map((key) => (
              <ListboxItem
                key={key}
                href={
                  onCategoryChange
                    ? undefined
                    : key === 'all'
                      ? '/help'
                      : `/help?category=${key}`
                }
                endContent={
                  countOf(key) === null ? null : (
                    <span className="text-xs text-default-400">
                      {countOf(key)}
                    </span>
                  )
                }
              >
                {key === 'all' ? '全部' : HELP_CATEGORY_LABELS[key]}
              </ListboxItem>
            ))}
          </Listbox>
        </CardBody>
      </Card>

      {mounted && data?.mine && (
        <MyList
          title="我发布的"
          scope="mine"
          list={data.mine}
          active={scope === 'mine'}
          empty="还没有发布过求助"
        />
      )}
      {mounted && data?.followed && (
        <MyList
          title="我关注的"
          scope="followed"
          list={data.followed}
          active={scope === 'followed'}
          empty="点「关注此帖」的求助会出现在这里，有新回答或解决时会通知你"
        />
      )}
    </aside>
  )
}
