'use client'

import { usePathname, useSearchParams } from 'next/navigation'
import { RefreshCw } from 'lucide-react'

import { Button } from '~/components/dashboard/ui/button'
import { Separator } from '~/components/dashboard/ui/separator'
import { SidebarTrigger } from '~/components/dashboard/ui/sidebar'
import { INBOX_KIND_LABELS } from '~/constants/dashboard'
import { INBOX_KINDS, type InboxKind } from '~/types/api/inbox'
import { cn } from '~/lib/dashboard/utils'

import { useDashboard } from './DashboardShell'
import { ThemeToggle } from './ThemeToggle'

// Normalizes the canonical comma-separated kinds param into the deduped set
// of valid selected kinds (any order, unknown segments ignored).
const parseSelectedKinds = (raw: string | null): InboxKind[] => {
  if (!raw) {
    return []
  }
  const selected = new Set<InboxKind>()
  for (const part of raw.split(',')) {
    const kind = part.trim()
    if ((INBOX_KINDS as readonly string[]).includes(kind)) {
      selected.add(kind as InboxKind)
    }
  }
  return Array.from(selected)
}

const USER_LEDGER_PATH = /^\/dashboard\/user\/\d+\/moemoepoint$/

export function DashboardHeader() {
  const { counts, countsLoading, countsError, refreshCounts } = useDashboard()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const selectedKinds = parseSelectedKinds(searchParams.get('kinds'))
  // Migrated pages get fixed titles; the dashboard inbox root keeps the
  // source-filter title logic (neutral unless exactly one valid kind).
  const title =
    pathname === '/dashboard'
      ? '统计总览'
      : pathname === '/dashboard/user'
        ? '用户管理'
        : USER_LEDGER_PATH.test(pathname)
          ? '用户萌萌点明细'
          : selectedKinds.length === 1
            ? INBOX_KIND_LABELS[selectedKinds[0]]
            : '待审事项'

  // The header is plain normal-flow content. On mobile it scrolls away with
  // the shared page flow (the SidebarInset scroll container); from md up the
  // inset does not scroll, so it stays fixed as before. It is intentionally
  // never sticky itself.
  return (
    <header className="flex min-h-14 shrink-0 flex-wrap items-center gap-x-2 gap-y-1 border-b bg-background px-4 py-2">
      <SidebarTrigger />
      <Separator orientation="vertical" className="h-4" />
      <h1 className="min-w-0 truncate text-sm font-medium">{title}</h1>
      <div className="ml-auto flex shrink-0 items-center gap-1">
        <span className="whitespace-nowrap text-xs text-muted-foreground">
          今日已处理{' '}
          {counts ? counts.todayProcessed : countsLoading ? '…' : '-'}
        </span>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="刷新待办计数"
          disabled={countsLoading}
          onClick={() => void refreshCounts()}
        >
          <RefreshCw className={cn(countsLoading && 'animate-spin')} />
        </Button>
        <ThemeToggle />
      </div>
      {countsError && (
        <p role="alert" className="basis-full text-xs text-destructive">
          {countsError}
        </p>
      )}
    </header>
  )
}
