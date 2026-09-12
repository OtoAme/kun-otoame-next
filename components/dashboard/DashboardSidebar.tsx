'use client'

import { useRef, useState } from 'react'
import Link from 'next/link'
import { usePathname, useSearchParams } from 'next/navigation'
import toast from 'react-hot-toast'
import {
  BarChart3,
  ChevronsUpDown,
  FileText,
  Flag,
  History,
  Home,
  Inbox,
  LayoutDashboard,
  LogOut,
  Megaphone,
  MessageSquare,
  Package,
  UserRound,
  Users,
  type LucideIcon
} from 'lucide-react'

import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar
} from '~/components/dashboard/ui/sidebar'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '~/components/dashboard/ui/dropdown-menu'
import {
  DASHBOARD_LEGACY_LINKS,
  INBOX_KIND_LABELS
} from '~/constants/dashboard'
import {
  INBOX_KINDS,
  type InboxCounts,
  type InboxKind
} from '~/types/api/inbox'
import { kunFetchPost } from '~/utils/kunFetch'
import { useUserStore } from '~/store/userStore'
import { useMessageStore } from '~/store/messageStore'
import { useSettingStore } from '~/store/settingStore'
import { cn } from '~/lib/dashboard/utils'

import { useDashboard, type DashboardCurrentUser } from './DashboardShell'

const KIND_ICONS: Record<InboxKind, LucideIcon> = {
  submission: FileText,
  'resource-apply': Package,
  feedback: MessageSquare,
  report: Flag
}

const getTotalPending = (counts: InboxCounts) =>
  INBOX_KINDS.reduce((sum, kind) => sum + counts.pending[kind], 0)

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

interface DashboardSidebarProps {
  currentUser: DashboardCurrentUser
}

export function DashboardSidebar({ currentUser }: DashboardSidebarProps) {
  const { counts, countsError } = useDashboard()
  const { setOpenMobile } = useSidebar()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const kindsParam = searchParams.get('kinds')
  const isStatsActive = pathname === '/dashboard'
  const isInboxRoot = pathname === '/dashboard/inbox'
  const selectedKinds = parseSelectedKinds(kindsParam)
  // All-inbox is active when there is no filter at all, or when the
  // canonical URL explicitly selects all four kinds. A partial multi-source
  // selection marks neither All nor any single source row.
  const isAllActive =
    isInboxRoot && (!kindsParam || selectedKinds.length === INBOX_KINDS.length)
  const isUserSectionActive =
    pathname === '/dashboard/user' || pathname.startsWith('/dashboard/user/')
  const isShoutboxActive = pathname.startsWith('/dashboard/shoutbox')
  const userSectionNeedsSuperAdmin = currentUser.role < 4
  const closeMobileSidebar = () => setOpenMobile(false)

  return (
    <Sidebar>
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton asChild onClick={closeMobileSidebar}>
              <Link href="/dashboard">
                <LayoutDashboard />
                <span className="font-medium">管理面板</span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton
                asChild
                isActive={isStatsActive}
                onClick={closeMobileSidebar}
              >
                <Link href="/dashboard">
                  <BarChart3 />
                  <span>统计总览</span>
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarGroup>

        <SidebarGroup>
          <SidebarGroupLabel>待审事项</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton
                  asChild
                  isActive={isAllActive}
                  onClick={closeMobileSidebar}
                >
                  <Link href="/dashboard/inbox">
                    <Inbox />
                    <span>全部待审事项</span>
                  </Link>
                </SidebarMenuButton>
                {counts && (
                  <SidebarMenuBadge>{getTotalPending(counts)}</SidebarMenuBadge>
                )}
              </SidebarMenuItem>
              {INBOX_KINDS.map((kind) => {
                const Icon = KIND_ICONS[kind]
                const isActive =
                  isInboxRoot &&
                  selectedKinds.length === 1 &&
                  selectedKinds[0] === kind
                return (
                  <SidebarMenuItem key={kind}>
                    <SidebarMenuButton
                      asChild
                      isActive={isActive}
                      onClick={closeMobileSidebar}
                    >
                      <Link href={`/dashboard/inbox?kinds=${kind}`}>
                        <Icon />
                        <span>{INBOX_KIND_LABELS[kind]}</span>
                      </Link>
                    </SidebarMenuButton>
                    {counts && (
                      <SidebarMenuBadge>
                        {counts.pending[kind]}
                      </SidebarMenuBadge>
                    )}
                  </SidebarMenuItem>
                )
              })}
            </SidebarMenu>
            {countsError && (
              <p className="px-2 pt-1 text-xs text-destructive">
                {countsError}
              </p>
            )}
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup>
          <SidebarGroupLabel>管理</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton
                  asChild
                  isActive={isShoutboxActive}
                  onClick={closeMobileSidebar}
                >
                  <Link href="/dashboard/shoutbox" title="小喇叭">
                    <Megaphone />
                    <span className="shrink-0 whitespace-nowrap">小喇叭</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton
                  asChild
                  isActive={isUserSectionActive}
                  onClick={closeMobileSidebar}
                >
                  <Link
                    href="/dashboard/user"
                    title={
                      userSectionNeedsSuperAdmin
                        ? '用户管理（仅超级管理员）'
                        : '用户管理'
                    }
                  >
                    <Users />
                    <span className="shrink-0 whitespace-nowrap">用户管理</span>
                    {userSectionNeedsSuperAdmin && (
                      <span
                        title="仅超级管理员"
                        className="ml-auto min-w-0 flex-1 truncate text-right text-xs text-muted-foreground"
                      >
                        仅超级管理员
                      </span>
                    )}
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup>
          <SidebarGroupLabel>旧版页面</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {DASHBOARD_LEGACY_LINKS.map((link) => {
                const needsSuperAdmin = currentUser.role < link.minRole
                return (
                  <SidebarMenuItem key={link.href}>
                    <SidebarMenuButton asChild onClick={closeMobileSidebar}>
                      <a
                        href={link.href}
                        title={
                          needsSuperAdmin
                            ? `${link.label}（处理需超级管理员）`
                            : link.label
                        }
                      >
                        <History />
                        <span className="shrink-0 whitespace-nowrap">
                          {link.label}
                        </span>
                        <span
                          className={cn(
                            'shrink-0 whitespace-nowrap rounded border px-1 text-[10px] leading-4 text-muted-foreground',
                            !needsSuperAdmin && 'ml-auto'
                          )}
                        >
                          旧
                        </span>
                        {needsSuperAdmin && (
                          <span
                            title="处理需超级管理员"
                            className="ml-auto min-w-0 flex-1 truncate text-right text-xs text-muted-foreground"
                          >
                            处理需超级管理员
                          </span>
                        )}
                      </a>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                )
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <DashboardUserMenu currentUser={currentUser} />
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  )
}

function DashboardUserMenu({ currentUser }: DashboardSidebarProps) {
  // Synchronous lock against duplicate submissions before any rerender.
  const loggingOutRef = useRef(false)
  const [loggingOut, setLoggingOut] = useState(false)

  const handleLogout = async () => {
    if (loggingOutRef.current) {
      return
    }
    loggingOutRef.current = true
    setLoggingOut(true)
    try {
      const result = await kunFetchPost<string | null>(
        '/user/status/logout',
        {}
      )
      if (typeof result === 'string') {
        toast.error(result || '退出登录失败，请稍后重试')
        loggingOutRef.current = false
        setLoggingOut(false)
        return
      }
      useUserStore.getState().logout()
      useMessageStore.getState().resetUnreadMessageStatus()
      useSettingStore.getState().resetData()
      window.location.assign('/')
    } catch {
      toast.error('退出登录失败，请检查网络后重试')
      loggingOutRef.current = false
      setLoggingOut(false)
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <SidebarMenuButton aria-label="用户菜单">
          <UserRound />
          <span>{currentUser.name}</span>
          <ChevronsUpDown className="ml-auto" />
        </SidebarMenuButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        side="top"
        align="start"
        className="w-(--radix-dropdown-menu-trigger-width) min-w-48"
      >
        <DropdownMenuLabel className="truncate">
          {currentUser.name}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <a href={`/user/${currentUser.id}`}>
            <UserRound />
            个人主页
          </a>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href="/" prefetch={false}>
            <Home />
            返回主站
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          variant="destructive"
          disabled={loggingOut}
          onSelect={() => void handleLogout()}
        >
          <LogOut />
          {loggingOut ? '正在退出…' : '退出登录'}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
