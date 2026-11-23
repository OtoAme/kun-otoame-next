'use client'

import { NavbarContent, NavbarItem } from '@heroui/navbar'
import Link from 'next/link'
import { Button } from '@heroui/button'
import { Skeleton } from '@heroui/skeleton'
import { useUserStore } from '~/store/userStore'
import { useMessageStore } from '~/store/messageStore'
import { refreshUserSession } from '~/utils/sessionClient'
import { ThemeSwitcher } from './ThemeSwitcher'
import { useMounted } from '~/hooks/useMounted'
import { UserDropdown } from './UserDropdown'
import { KunSearch } from './Search'
import { UserMessageBell } from './UserMessageBell'
import { Tooltip } from '@heroui/tooltip'
import { RandomGalgameButton } from '~/components/home/carousel/RandomGalgameButton'

export const KunTopBarUser = () => {
  const { user, sessionStatus } = useUserStore((state) => state)
  const { hasUnreadNotification, hasUnreadConversation } = useMessageStore(
    (state) => state
  )
  const isMounted = useMounted()

  const hasUnread = hasUnreadNotification || hasUnreadConversation

  return (
    <NavbarContent as="div" className="items-center" justify="end">
      {(!isMounted || sessionStatus === 'checking') && (
        <>
          <Skeleton className="hidden rounded-lg lg:flex">
            <div className="w-32 h-10 rounded-lg bg-default-300" />
          </Skeleton>
          <Skeleton className="rounded-lg lg:hidden">
            <div className="w-20 h-10 rounded-lg bg-default-300" />
          </Skeleton>
        </>
      )}

      {isMounted &&
        (sessionStatus === 'guest' || sessionStatus === 'unavailable') && (
          <NavbarContent justify="end">
            <NavbarItem className="hidden lg:flex">
              <Link href="/login">登录</Link>
            </NavbarItem>
            <NavbarItem>
              <Button
                as={Link}
                color="primary"
                href="/register"
                variant="flat"
                className="hidden lg:flex"
              >
                注册
              </Button>
            </NavbarItem>
            <NavbarItem className="flex lg:hidden">
              <Button as={Link} color="primary" href="/login" variant="flat">
                登录
              </Button>
            </NavbarItem>
          </NavbarContent>
        )}

      {isMounted && sessionStatus === 'unavailable' && (
        <Button
          size="sm"
          variant="light"
          onPress={() => {
            void refreshUserSession()
          }}
        >
          会话验证失败，重试
        </Button>
      )}

      <KunSearch />

      <Tooltip disableAnimation showArrow closeDelay={0} content="随机一部游戏">
        <RandomGalgameButton isIconOnly variant="light" />
      </Tooltip>

      <ThemeSwitcher />

      {isMounted && sessionStatus === 'authenticated' && user.name && (
        <>
          <UserMessageBell hasUnreadMessages={hasUnread} />

          <UserDropdown />
        </>
      )}
    </NavbarContent>
  )
}
