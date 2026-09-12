'use client'

import { RefreshCw } from 'lucide-react'
import { Button } from '~/components/dashboard/ui/button'
import { Skeleton } from '~/components/dashboard/ui/skeleton'
import { Tabs, TabsList, TabsTrigger } from '~/components/dashboard/ui/tabs'
import {
  ADMIN_SHOUTBOX_TAB_LABELS,
  ADMIN_SHOUTBOX_TABS,
  useAdminShoutbox,
  type AdminShoutboxTab
} from '~/hooks/dashboard/useAdminShoutbox'
import { ShoutboxAdminItem } from './ShoutboxAdminItem'
import { ShoutboxOfficialForm } from './ShoutboxOfficialForm'

const SKELETON_ROWS = 4

const EMPTY_TEXT: Record<AdminShoutboxTab, string> = {
  official: '还没有官方消息',
  pending_review: '没有待复核的小喇叭',
  public: '暂无公开中的小喇叭',
  removed: '暂无已终止的记录'
}

/**
 * Console shoutbox page. The official tab keeps the publish form and the
 * edit / end / cancel lifecycle actions; the other tabs list review, public
 * and removed records with moderation actions. Every state change goes
 * through a confirmation dialog before writing.
 */
export const DashboardShoutbox = () => {
  const {
    query,
    items,
    page,
    totalPages,
    loading,
    refreshing,
    error,
    refresh,
    setTab,
    setPage
  } = useAdminShoutbox()

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col gap-4 overflow-y-auto p-4">
      <Tabs
        value={query.tab}
        onValueChange={(value) => setTab(value as AdminShoutboxTab)}
      >
        <div className="flex flex-wrap items-center gap-2">
          <TabsList>
            {ADMIN_SHOUTBOX_TABS.map((tab) => (
              <TabsTrigger key={tab} value={tab}>
                {ADMIN_SHOUTBOX_TAB_LABELS[tab]}
              </TabsTrigger>
            ))}
          </TabsList>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={refresh}
            disabled={loading || refreshing}
          >
            <RefreshCw className={refreshing ? 'animate-spin' : undefined} />
            {refreshing ? '刷新中…' : '刷新'}
          </Button>
        </div>

        {query.tab === 'official' && (
          <div className="mt-3">
            <ShoutboxOfficialForm onPublished={refresh} />
          </div>
        )}

        <div className="mt-3 space-y-2">
          {loading ? (
            <div role="status" aria-busy="true" aria-label="正在加载小喇叭列表">
              {Array.from({ length: SKELETON_ROWS }).map((_, index) => (
                <Skeleton
                  key={`shoutbox-skeleton-${index}`}
                  className="mb-2 h-24 w-full"
                />
              ))}
            </div>
          ) : error !== null ? (
            <div className="flex flex-col items-center justify-center gap-3 rounded-md border py-10">
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
              <Button variant="outline" size="sm" onClick={refresh}>
                重试
              </Button>
            </div>
          ) : items.length === 0 ? (
            <div className="flex h-32 flex-col items-center justify-center gap-2 rounded-md border text-center">
              <p className="text-sm text-muted-foreground">
                {EMPTY_TEXT[query.tab]}
              </p>
            </div>
          ) : (
            items.map((item) => (
              <ShoutboxAdminItem
                key={item.id}
                item={item}
                onChanged={refresh}
              />
            ))
          )}
        </div>

        {totalPages > 1 && (
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm text-muted-foreground">
              第 {page} / {totalPages} 页
            </p>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setPage(page - 1)}
                disabled={loading || page <= 1}
              >
                上一页
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setPage(page + 1)}
                disabled={loading || page >= totalPages}
              >
                下一页
              </Button>
            </div>
          </div>
        )}
      </Tabs>
    </div>
  )
}
