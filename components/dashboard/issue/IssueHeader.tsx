'use client'

import Image from 'next/image'
import Link from 'next/link'
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
import { Separator } from '~/components/dashboard/ui/separator'
import { kunMoyuMoe } from '~/config/moyu-moe'

export interface IssueHeaderUser {
  id: number
  name: string
}

/**
 * 用户侧自有顶栏。导航只放真实可去的地方：站点、问题处理本身、用户菜单。
 * 知识库属模块 07，不做空壳入口；提交入口在站点页面内，站务反馈在工作区页头。
 */
export function IssueHeader({ user }: { user: IssueHeaderUser | null }) {
  const initial = user?.name.trim().slice(0, 1) || '我'

  return (
    <header className="sticky top-0 z-20 border-b bg-background">
      <div className="mx-auto flex h-14 w-full max-w-7xl items-center gap-3 px-4">
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
          <span className="text-sm font-semibold">{kunMoyuMoe.titleShort}</span>
        </Link>

        <Separator orientation="vertical" className="hidden h-5 sm:block" />

        <nav aria-label="问题处理导航" className="hidden sm:block">
          <Link
            href="/issue"
            aria-current="page"
            className="rounded-md px-2 py-1 text-sm font-medium text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            问题处理
          </Link>
        </nav>

        <div className="ml-auto flex shrink-0 items-center gap-2">
          {user ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="gap-2 px-1.5"
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
          ) : (
            <Button asChild size="sm">
              <Link href="/login" prefetch={false}>
                登录
              </Link>
            </Button>
          )}
        </div>
      </div>
    </header>
  )
}
