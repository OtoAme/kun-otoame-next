'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { Button } from '@heroui/button'
import { Card, CardBody } from '@heroui/card'
import { Chip } from '@heroui/chip'
import { Select, SelectItem } from '@heroui/select'
import { Tab, Tabs } from '@heroui/tabs'
import {
  Bell,
  BookOpen,
  MessageCircleQuestion,
  MessageSquare,
  Plus
} from 'lucide-react'
import { KunHeader } from '~/components/kun/Header'
import { KunLoading } from '~/components/kun/Loading'
import { KunNull } from '~/components/kun/Null'
import { KunPagination } from '~/components/kun/Pagination'
import {
  HELP_CATEGORIES,
  HELP_CATEGORY_LABELS,
  HELP_NO_RESPONSE_DUTY,
  HELP_NOTICE_HREF,
  HELP_PAGE_SIZE,
  HELP_SCOPE_LABELS,
  HELP_SCOPES,
  type HelpCategory,
  type HelpScope,
  type HelpSort,
  type HelpStatus
} from '~/constants/help'
import { kunFetchGet } from '~/utils/kunFetch'
import { formatTimeDifference } from '~/utils/time'
import { HelpLayout } from './HelpLayout'
import { HelpSidebar } from './HelpSidebar'
import { HelpGameChip } from './HelpGameChip'
import { HelpStatusChip } from './HelpStatusChip'
import { HelpUserLink } from './HelpUserLink'
import type { HelpListResponse } from '~/types/api/help'

interface Props {
  initial: HelpListResponse | null
  initialCategory?: HelpCategory
  initialScope?: HelpScope
  /** Own scopes only make sense with a session. */
  signedIn?: boolean
}

type StatusFilter = HelpStatus | 'all'
type CategoryFilter = HelpCategory | 'all'

export const HelpListContainer = ({
  initial,
  initialCategory,
  initialScope = 'all',
  signedIn = false
}: Props) => {
  const [data, setData] = useState<HelpListResponse | null>(initial)
  const [loading, setLoading] = useState(initial === null)
  const [error, setError] = useState('')
  const [page, setPage] = useState(1)
  const [category, setCategory] = useState<CategoryFilter>(
    initialCategory ?? 'all'
  )
  const [status, setStatus] = useState<StatusFilter>('all')
  const [sort, setSort] = useState<HelpSort>('latest')
  const [scope, setScope] = useState<HelpScope>(initialScope)
  const seqRef = useRef(0)
  const firstRef = useRef(initial !== null)

  useEffect(() => {
    // The server already rendered the default first page.
    if (firstRef.current) {
      firstRef.current = false
      return
    }
    const seq = ++seqRef.current
    setLoading(true)
    setError('')
    kunFetchGet<HelpListResponse | string>('/help', {
      page,
      limit: HELP_PAGE_SIZE,
      sort,
      scope,
      ...(category === 'all' ? {} : { category }),
      ...(status === 'all' ? {} : { status })
    })
      .then((response) => {
        if (seq !== seqRef.current) return
        if (typeof response === 'string') {
          setError(response)
          return
        }
        setData(response)
      })
      .catch(() => {
        if (seq === seqRef.current) setError('读取求助列表失败，请稍后重试')
      })
      .finally(() => {
        if (seq === seqRef.current) setLoading(false)
      })
  }, [page, category, status, sort, scope])

  // Keep the URL in step so 查看全部 links, reloads and sharing land on the
  // same scope; the other filters stay local as before.
  useEffect(() => {
    const url = new URL(window.location.href)
    if (scope === 'all') url.searchParams.delete('scope')
    else url.searchParams.set('scope', scope)
    window.history.replaceState(null, '', url)
  }, [scope])

  const resetPage = () => setPage(1)

  return (
    <HelpLayout
      sidebar={
        <HelpSidebar
          category={category}
          scope={scope}
          status={status === 'all' ? undefined : status}
          onCategoryChange={(value) => {
            setCategory(value)
            resetPage()
          }}
        />
      }
    >
      <KunHeader
        name="求助区"
        description={`运行、下载、解压问题，求游戏或资源，都可以在这里向社区提问。${HELP_NO_RESPONSE_DUTY}`}
        headerEndContent={
          <Button
            as={Link}
            href="/help/create"
            color="primary"
            className="lg:hidden"
            startContent={<Plus className="size-4" />}
          >
            发布求助
          </Button>
        }
        endContent={
          <p className="flex items-center gap-1 text-sm text-default-500">
            <BookOpen className="size-4" aria-hidden />
            第一次来？先看看
            <Link
              href={HELP_NOTICE_HREF}
              className="text-primary hover:underline"
            >
              《求助区使用说明》
            </Link>
            ，了解怎么提问、费用与采纳奖励。
          </p>
        }
      />

      {signedIn && (
        <Tabs
          aria-label="范围"
          variant="underlined"
          selectedKey={scope}
          onSelectionChange={(key) => {
            setScope(key as HelpScope)
            resetPage()
          }}
        >
          {HELP_SCOPES.map((item) => (
            <Tab key={item} title={HELP_SCOPE_LABELS[item]} />
          ))}
        </Tabs>
      )}

      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <Select
          label="分类"
          labelPlacement="outside"
          className="sm:max-w-48 lg:hidden"
          selectedKeys={[category]}
          onSelectionChange={(keys) => {
            const value = Array.from(keys)[0]
            if (!value) return
            setCategory(value as CategoryFilter)
            resetPage()
          }}
        >
          {[
            <SelectItem key="all">全部分类</SelectItem>,
            ...HELP_CATEGORIES.map((item) => (
              <SelectItem key={item}>{HELP_CATEGORY_LABELS[item]}</SelectItem>
            ))
          ]}
        </Select>
        <Tabs
          aria-label="状态"
          selectedKey={status}
          onSelectionChange={(key) => {
            setStatus(key as StatusFilter)
            resetPage()
          }}
        >
          <Tab key="all" title="全部" />
          <Tab key="open" title="未解决" />
          <Tab key="solved" title="已解决" />
        </Tabs>
        <Tabs
          aria-label="排序"
          selectedKey={sort}
          onSelectionChange={(key) => {
            setSort(key as HelpSort)
            resetPage()
          }}
        >
          <Tab key="latest" title="最新" />
          <Tab key="unanswered" title="没有回答" />
        </Tabs>
      </div>

      {loading ? (
        <KunLoading hint="正在读取求助列表" />
      ) : error || !data || data.posts.length === 0 ? (
        // KunNull fills its parent; give it a bounded box of its own so it
        // never grows over the footer.
        <div className="flex h-64 items-center justify-center">
          <KunNull
            message={
              error ||
              (scope === 'mine'
                ? '还没有发布过求助'
                : scope === 'followed'
                  ? '还没有关注的求助'
                  : '暂无求助')
            }
          />
        </div>
      ) : (
        <div className="space-y-3">
          {data.posts.map((post) => (
            <Card
              key={post.id}
              className="relative transition-shadow hover:shadow-medium"
            >
              <CardBody className="flex-row items-stretch gap-3">
                <div className="min-w-0 flex-1 space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <HelpStatusChip status={post.status} />
                    <Chip size="sm" variant="bordered">
                      {HELP_CATEGORY_LABELS[post.category]}
                    </Chip>
                    <HelpGameChip
                      patch={post.patch}
                      gameName={post.gameName}
                      linkCount={post.gameLinkCount}
                    />
                  </div>
                  <h2 className="break-words text-lg font-medium">
                    <Link
                      href={`/help/${post.id}`}
                      className="after:absolute after:inset-0 after:content-[''] hover:text-primary"
                    >
                      {post.title}
                    </Link>
                  </h2>
                  {post.excerpt && (
                    <p className="line-clamp-2 break-words text-sm text-default-500">
                      {post.excerpt}
                    </p>
                  )}
                  <div className="flex flex-wrap items-center gap-4 text-xs text-default-400">
                    <HelpUserLink
                      user={post.user}
                      avatar="xs"
                      className="relative z-10"
                    />
                    <span>{formatTimeDifference(post.created)}</span>
                    <span className="flex items-center gap-1">
                      <MessageSquare className="size-3.5" aria-hidden />
                      {post.answerCount} 个回答
                    </span>
                    <span className="flex items-center gap-1">
                      <Bell className="size-3.5" aria-hidden />
                      {post.followCount} 人关注
                    </span>
                  </div>
                </div>
                {post.thumbnail && (
                  // The frame stretches to the card height; the image fills
                  // it and is cropped around its centre.
                  <div className="pointer-events-none relative min-h-20 w-28 shrink-0 overflow-hidden rounded-medium border border-default-200 sm:w-48">
                    {/* Plain img: user images come from any https host, which
                        next/image's remote allow-list does not cover. */}
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={post.thumbnail}
                      alt=""
                      loading="lazy"
                      referrerPolicy="no-referrer"
                      className="absolute inset-0 size-full object-cover"
                    />
                  </div>
                )}
              </CardBody>
            </Card>
          ))}
        </div>
      )}

      {data && data.total > HELP_PAGE_SIZE && (
        <div className="flex justify-center">
          <KunPagination
            total={Math.ceil(data.total / HELP_PAGE_SIZE)}
            page={page}
            onPageChange={setPage}
            isLoading={loading}
          />
        </div>
      )}
      <p className="flex items-center gap-1 text-xs text-default-400">
        <MessageCircleQuestion className="size-3.5" aria-hidden />
        需要网站管理员修改数据的请求，请到工作台
        <Link href="/workspace/issues" className="text-primary hover:underline">
          「问题处理」
        </Link>
        提交站务反馈。
      </p>
    </HelpLayout>
  )
}
