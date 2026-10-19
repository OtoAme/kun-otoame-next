'use client'

import Image from 'next/image'
import Link from 'next/link'
import { createContext, useContext } from 'react'
import { usePathname } from 'next/navigation'
import { ChevronDown, House, UserRound } from 'lucide-react'
import { Button } from '~/components/dashboard/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '~/components/dashboard/ui/dropdown-menu'
import { kunMoyuMoe } from '~/config/moyu-moe'
import { cn } from '~/lib/dashboard/utils'
import type { WorkspaceUser } from '~/types/api/workspace'

const WorkspaceUserContext = createContext<WorkspaceUser | null>(null)

export function WorkspaceUserProvider({
  user,
  children
}: {
  user: WorkspaceUser
  children: React.ReactNode
}) {
  return (
    <WorkspaceUserContext.Provider value={user}>
      {children}
    </WorkspaceUserContext.Provider>
  )
}

export function useWorkspaceUser(): WorkspaceUser {
  const user = useContext(WorkspaceUserContext)
  if (!user) {
    throw new Error('useWorkspaceUser must be used within WorkspaceShell')
  }
  return user
}

const NAV = [
  { href: '/workspace/entries', label: '我的条目' },
  { href: '/workspace/resources', label: '我的资源' },
  { href: '/workspace/issues', label: '问题处理' }
] as const

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

  return (
    <WorkspaceUserProvider user={user}>
      <div className="min-h-dvh bg-muted/40">
        <header className="sticky top-0 z-20 border-b bg-background">
          <div className="mx-auto flex w-full max-w-7xl flex-wrap items-center gap-2 px-3 py-2 sm:h-14 sm:flex-nowrap sm:px-4 sm:py-0">
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
              className="flex min-w-0 flex-1 flex-wrap items-center gap-1"
            >
              {NAV.map((item) => {
                const active =
                  pathname === item.href || pathname.startsWith(`${item.href}/`)
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    prefetch={false}
                    aria-current={active ? 'page' : undefined}
                    className={cn(
                      'rounded-md px-2 py-1.5 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
                      active
                        ? 'bg-accent font-medium text-foreground'
                        : 'text-muted-foreground'
                    )}
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
