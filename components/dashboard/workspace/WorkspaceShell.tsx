'use client'

import Image from 'next/image'
import Link from 'next/link'
import { useEffect, useState } from 'react'
import { usePathname } from 'next/navigation'
import { ChevronDown, House, Menu, UserRound } from 'lucide-react'
import { Button } from '~/components/dashboard/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '~/components/dashboard/ui/dropdown-menu'
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger
} from '~/components/dashboard/ui/sheet'
import { kunMoyuMoe } from '~/config/moyu-moe'
import { cn } from '~/lib/dashboard/utils'
import type { WorkspaceUser } from '~/types/api/workspace'
import { WorkspaceUserProvider, useWorkspaceUser } from './WorkspaceUserContext'

export { WorkspaceUserProvider, useWorkspaceUser }

/**
 * Turn a thrown kunFetch failure into user text.
 * A response-less failure stays on `fallback` and never invents a request id.
 * A status response prefers the server's own message.
 */
export function workspaceActionError(error: unknown, fallback: string): string {
  const raw = error instanceof Error ? error.message : ''
  const match = /Status:\s*(\d+)(?:;\s*Message:\s*([\s\S]*))?/.exec(raw)
  if (!match) return fallback
  const status = Number(match[1])
  const server = match[2]?.replace(/\s+/g, ' ').trim() ?? ''
  if (server) return server
  if (status === 401) return '登录已失效，请重新登录后再试'
  if (status === 403) return '没有权限完成这个操作'
  if (status === 404) return '内容不存在或已不可用'
  if (status === 409) return '内容已变化，请载入最新内容后再试'
  if (status === 429) return '操作过于频繁，请稍后重试'
  if (status >= 500) return '服务器暂时无法完成操作，请稍后重试'
  return fallback
}

const NAV = [
  { href: '/workspace/entries', label: '我的条目' },
  { href: '/workspace/resources', label: '我的资源' },
  { href: '/workspace/issues', label: '问题处理' }
] as const

const isWorkspaceSection = (pathname: string, href: string) =>
  pathname === href || pathname.startsWith(`${href}/`)

const sectionLinkClass = (active: boolean, compact: boolean) =>
  cn(
    'rounded-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
    compact ? 'px-2 py-1.5 text-sm' : 'px-3 py-3 text-base font-semibold',
    active ? 'bg-accent font-medium text-foreground' : 'text-muted-foreground'
  )

/**
 * Independent shadcn shell for every signed-in user. It does not mount
 * DashboardShell and does not request site-wide counters.
 */
export function WorkspaceShell({
  user,
  children
}: {
  user: WorkspaceUser
  children: React.ReactNode
}) {
  const pathname = usePathname()
  const initial = user.name.trim().slice(0, 1) || '我'
  const [navOpen, setNavOpen] = useState(false)

  useEffect(() => {
    setNavOpen(false)
  }, [pathname])

  return (
    <WorkspaceUserProvider user={user}>
      <div className="min-h-dvh bg-muted/40">
        <header className="sticky top-0 z-20 border-b bg-background">
          <div className="mx-auto flex h-14 w-full max-w-7xl items-center gap-2 px-3 sm:px-4">
            <Sheet open={navOpen} onOpenChange={setNavOpen}>
              <SheetTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="sm:hidden"
                  aria-label={navOpen ? '关闭导航' : '打开导航'}
                >
                  <Menu aria-hidden />
                </Button>
              </SheetTrigger>
              <SheetContent side="left" className="w-72 gap-2">
                <SheetHeader>
                  <SheetTitle>用户工作台</SheetTitle>
                </SheetHeader>
                <nav aria-label="用户工作台" className="grid gap-1 px-4">
                  {NAV.map((item) => {
                    const active = isWorkspaceSection(pathname, item.href)
                    return (
                      <SheetClose asChild key={item.href}>
                        <Link
                          href={item.href}
                          prefetch={false}
                          aria-current={active ? 'page' : undefined}
                          className={sectionLinkClass(active, false)}
                        >
                          {item.label}
                        </Link>
                      </SheetClose>
                    )
                  })}
                </nav>
              </SheetContent>
            </Sheet>
            <Link
              href="/"
              prefetch={false}
              className="flex shrink-0 items-center gap-2 rounded-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              <Image
                src="/favicon.webp"
                alt=""
                width={28}
                height={28}
                priority
                className="shrink-0"
              />
              <span className="text-sm font-semibold">
                {kunMoyuMoe.titleShort}
              </span>
            </Link>
            <nav
              aria-label="用户工作台"
              className="hidden min-w-0 flex-1 items-center gap-1 sm:flex"
            >
              {NAV.map((item) => {
                const active = isWorkspaceSection(pathname, item.href)
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    prefetch={false}
                    aria-current={active ? 'page' : undefined}
                    className={sectionLinkClass(active, true)}
                  >
                    {item.label}
                  </Link>
                )
              })}
            </nav>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="ml-auto gap-2 px-1.5"
                >
                  <span className="flex size-6 items-center justify-center rounded-full bg-muted text-xs font-medium">
                    {initial}
                  </span>
                  <span className="hidden max-w-32 truncate sm:inline">
                    {user.name}
                  </span>
                  <ChevronDown className="size-4" aria-hidden />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-44">
                <DropdownMenuLabel className="truncate">
                  {user.name}
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem asChild>
                  <Link href={`/user/${user.id}`} prefetch={false}>
                    <UserRound className="size-4" aria-hidden />
                    个人主页
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link href="/" prefetch={false}>
                    <House className="size-4" aria-hidden />
                    返回站点
                  </Link>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>
        <main className="mx-auto w-full min-w-0 max-w-7xl px-3 py-4 sm:px-4 sm:py-6">
          {children}
        </main>
      </div>
    </WorkspaceUserProvider>
  )
}
