'use client'

import { useRef, useState } from 'react'
import Link from 'next/link'
import { usePathname, useSearchParams } from 'next/navigation'
import toast from 'react-hot-toast'
import {
  Archive,
  BadgeCheck,
  ChevronsUpDown,
  ClipboardList,
  FileText,
  Flag,
  Gamepad2,
  HardDriveDownload,
  History,
  Home,
  Inbox,
  LayoutDashboard,
  LogOut,
  Mail,
  Megaphone,
  Merge,
  MessageCircle,
  MessageSquare,
  OctagonAlert,
  Package,
  PenLine,
  ScrollText,
  Settings,
  Star,
  Sticker,
  Unlink,
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
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarRail,
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
  getVisibleDashboardNav,
  isDashboardNavActive,
  LINK_HEALTH_INBOX_KIND_LABELS,
  type DashboardNavItem
} from '~/constants/dashboard'
import {
  LINK_HEALTH_INBOX_KINDS,
  type LinkHealthInboxCounts,
  type LinkHealthInboxKind
} from '~/types/api/inbox'
import { kunFetchPost } from '~/utils/kunFetch'
import { useUserStore } from '~/store/userStore'
import { useMessageStore } from '~/store/messageStore'
import { useSettingStore } from '~/store/settingStore'

import { useDashboard, type DashboardCurrentUser } from './DashboardShell'

// Navigation icons are drawn one step larger than the shadcn default so the
// groups can be scanned by shape (redesign requirement 3.4).
const NAV_BUTTON_CLASS = '[&>svg]:size-5'

const NAV_ICONS: Record<string, LucideIcon> = {
  overview: LayoutDashboard,
  inbox: Inbox,
  case: ClipboardList,
  creator: BadgeCheck,
  game: Gamepad2,
  resource: HardDriveDownload,
  comment: MessageCircle,
  rating: Star,
  sticker: Sticker,
  'link-health': Unlink,
  'company-merges': Merge,
  submission: History,
  'archive-feedback': Archive,
  'archive-report': Flag,
  'archive-rating-report': OctagonAlert,
  shoutbox: Megaphone,
  user: Users,
  log: ScrollText,
  setting: Settings,
  email: Mail
}

const KIND_ICONS: Record<LinkHealthInboxKind, LucideIcon> = {
  submission: FileText,
  'resource-apply': Package,
  feedback: MessageSquare,
  report: Flag,
  case: ClipboardList,
  'broken-link': Unlink
}

const getTotalPending = (counts: LinkHealthInboxCounts) =>
  LINK_HEALTH_INBOX_KINDS.reduce((sum, kind) => sum + counts.pending[kind], 0)

// Normalizes the canonical comma-separated kinds param into the deduped set
// of valid selected kinds (any order, unknown segments ignored).
const parseSelectedKinds = (raw: string | null): LinkHealthInboxKind[] => {
  if (!raw) {
    return []
  }
  const selected = new Set<LinkHealthInboxKind>()
  for (const part of raw.split(',')) {
    const kind = part.trim()
    if ((LINK_HEALTH_INBOX_KINDS as readonly string[]).includes(kind)) {
      selected.add(kind as LinkHealthInboxKind)
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
  const isInboxRoot = pathname === '/dashboard/inbox'
  const selectedKinds = parseSelectedKinds(kindsParam)
  // The inbox parent row is active when there is no filter at all, or when
  // the canonical URL explicitly selects every kind. A partial multi-source
  // selection marks neither the parent nor any single source row.
  const submissionStatus = searchParams.get('submissionStatus')
  // Submission history is the inbox filtered to submissions in any status
  // other than pending; it has its own sidebar entry.
  const isSubmissionHistory =
    isInboxRoot &&
    selectedKinds.length === 1 &&
    selectedKinds[0] === 'submission' &&
    submissionStatus !== null &&
    submissionStatus !== 'pending'
  const isAllActive =
    isInboxRoot &&
    !isSubmissionHistory &&
    (!kindsParam || selectedKinds.length === LINK_HEALTH_INBOX_KINDS.length)
  const closeMobileSidebar = () => setOpenMobile(false)
  const groups = getVisibleDashboardNav(currentUser.role)

  const renderLink = (item: DashboardNavItem) => {
    const Icon = NAV_ICONS[item.id]
    const content = (
      <>
        <Icon />
        <span>{item.label}</span>
      </>
    )
    // Legacy pages live under the other root layout, so they get a plain
    // anchor and a full page load instead of client navigation.
    return item.legacy ? (
      <a href={item.href}>{content}</a>
    ) : (
      <Link href={item.href}>{content}</Link>
    )
  }

  const renderItem = (item: DashboardNavItem) => {
    const isInbox = item.id === 'inbox'
    const isActive = isInbox
      ? isAllActive
      : item.id === 'submission'
        ? isSubmissionHistory
        : isDashboardNavActive(item, pathname)
    return (
      <SidebarMenuItem key={item.id}>
        <SidebarMenuButton
          asChild
          isActive={isActive}
          tooltip={item.label}
          className={NAV_BUTTON_CLASS}
          onClick={closeMobileSidebar}
        >
          {renderLink(item)}
        </SidebarMenuButton>
        {isInbox && counts && (
          <SidebarMenuBadge>{getTotalPending(counts)}</SidebarMenuBadge>
        )}
        {/* Per-source rows only while on the inbox, so the rest of the
            navigation fits without scrolling. */}
        {isInbox && isInboxRoot && (
          <SidebarMenuSub>
            {LINK_HEALTH_INBOX_KINDS.map((kind) => {
              const Icon = KIND_ICONS[kind]
              const isKindActive =
                isInboxRoot &&
                !isSubmissionHistory &&
                selectedKinds.length === 1 &&
                selectedKinds[0] === kind
              return (
                <SidebarMenuSubItem key={kind}>
                  <SidebarMenuSubButton
                    asChild
                    isActive={isKindActive}
                    onClick={closeMobileSidebar}
                  >
                    <Link href={`/dashboard/inbox?kinds=${kind}`}>
                      <Icon />
                      <span>{LINK_HEALTH_INBOX_KIND_LABELS[kind]}</span>
                      {counts && (
                        <span className="ml-auto text-xs text-muted-foreground tabular-nums">
                          {counts.pending[kind]}
                        </span>
                      )}
                    </Link>
                  </SidebarMenuSubButton>
                </SidebarMenuSubItem>
              )
            })}
          </SidebarMenuSub>
        )}
        {isInbox && countsError && (
          <p className="px-2 pt-1 text-xs text-destructive group-data-[collapsible=icon]:hidden">
            {countsError}
          </p>
        )}
      </SidebarMenuItem>
    )
  }

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              asChild
              size="lg"
              tooltip="OtoAme 站方控制台"
              onClick={closeMobileSidebar}
            >
              <Link href="/dashboard">
                <span className="flex aspect-square size-8 items-center justify-center rounded-lg bg-sidebar-primary text-sm font-bold text-sidebar-primary-foreground">
                  O
                </span>
                <span className="grid flex-1 text-left leading-tight">
                  <span className="truncate font-semibold">OtoAme</span>
                  <span className="truncate text-xs text-muted-foreground">
                    站方控制台
                  </span>
                </span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        {groups.map((group) => (
          <SidebarGroup key={group.label ?? 'top'}>
            {group.label && (
              <SidebarGroupLabel>{group.label}</SidebarGroupLabel>
            )}
            <SidebarGroupContent>
              <SidebarMenu>{group.items.map(renderItem)}</SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>

      <SidebarFooter>
        <SidebarMenu>
          {/* The game editor itself requires a super administrator. */}
          {currentUser.role >= 4 && (
            <SidebarMenuItem>
              <SidebarMenuButton
                asChild
                tooltip="发布游戏"
                className={NAV_BUTTON_CLASS}
              >
                <a href="/edit/create">
                  <PenLine />
                  <span>发布游戏</span>
                </a>
              </SidebarMenuButton>
            </SidebarMenuItem>
          )}
          <SidebarMenuItem>
            <SidebarMenuButton
              asChild
              tooltip="返回前台"
              className={NAV_BUTTON_CLASS}
            >
              <a href="/">
                <Home />
                <span>返回前台</span>
              </a>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <DashboardUserMenu currentUser={currentUser} />
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
      <SidebarRail />
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
        <SidebarMenuButton
          aria-label="用户菜单"
          tooltip={currentUser.name}
          className={NAV_BUTTON_CLASS}
        >
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
