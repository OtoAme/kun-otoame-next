'use client'

import Link from 'next/link'
import { Button } from '@heroui/button'
import { useDisclosure } from '@heroui/modal'
import { Tooltip } from '@heroui/tooltip'
import { Flag } from 'lucide-react'
import { useMounted } from '~/hooks/useMounted'
import { useUserStore } from '~/store/userStore'
import { CaseLoginPrompt } from '~/components/case/CaseLoginPrompt'
import { CaseViolationReportModal } from '~/components/case/CaseViolationReportModal'
import { notifyShoutboxPublicWrite } from './query/core'
import { useShoutboxQueryContextOrNull } from './query/ShoutboxQueryProvider'

interface Props {
  shoutboxId: number
  authorId: number
  /**
   * Server-computed from the author's current role: false on every message
   * by a super administrator (role 4), ordinary or official alike. It gates
   * only the report flow — the role >= 3 review navigation below stays
   * available on those messages.
   */
  reportable: boolean
  /** Compact rows use an icon-only trigger with an accessible name. */
  isIconOnly?: boolean
}

/**
 * Right-side entry for a single shoutbox message, shared by the full card
 * and the compact rows. The author's own message never shows it — for
 * administrators either. Administrators (role >= 3) get a same-size review
 * entry on other people's messages that only navigates to the dashboard's
 * targeted view and never submits a report; everyone else gets the shared
 * case report form, and guests the login prompt. A message the server marks
 * not reportable renders no report entry at all — without the entry there
 * is no path that could submit such a report.
 */
export const ShoutboxReportButton = ({
  shoutboxId,
  authorId,
  reportable,
  isIconOnly = false
}: Props) => {
  const mounted = useMounted()
  const currentUserId = useUserStore((state) => state.user.uid)
  const role = useUserStore((state) => state.user.role)
  const reportModal = useDisclosure()
  const loginModal = useDisclosure()
  const shoutboxQuery = useShoutboxQueryContextOrNull()

  // Own-check needs the persisted user: render nothing until mounted to avoid
  // hydration drift, and never for the author.
  if (!mounted || (currentUserId > 0 && currentUserId === authorId)) {
    return null
  }

  if (role >= 3) {
    const href = `/dashboard/shoutbox?shoutbox=${shoutboxId}`
    const review = isIconOnly ? (
      <Button
        size="sm"
        variant="light"
        isIconOnly
        as={Link}
        href={href}
        aria-label="审查小喇叭"
      >
        <Flag className="size-3.5" />
      </Button>
    ) : (
      <Button
        size="sm"
        variant="light"
        as={Link}
        href={href}
        startContent={<Flag className="size-3.5" />}
      >
        审查小喇叭
      </Button>
    )
    return isIconOnly ? (
      <Tooltip content="审查小喇叭">{review}</Tooltip>
    ) : (
      review
    )
  }

  // Ordinary users and guests: a non-reportable message gets no entry at
  // all (not even the login prompt), so nothing here can reach the report
  // API for it.
  if (!reportable) {
    return null
  }

  const handleClick = () => {
    if (currentUserId > 0) {
      reportModal.onOpen()
    } else {
      loginModal.onOpen()
    }
  }

  const trigger = isIconOnly ? (
    <Button
      size="sm"
      variant="light"
      isIconOnly
      aria-label="举报"
      onPress={handleClick}
    >
      <Flag className="size-3.5" />
    </Button>
  ) : (
    <Button
      size="sm"
      variant="light"
      startContent={<Flag className="size-3.5" />}
      onPress={handleClick}
    >
      举报
    </Button>
  )

  return (
    <>
      {isIconOnly ? <Tooltip content="举报">{trigger}</Tooltip> : trigger}

      <CaseViolationReportModal
        isOpen={reportModal.isOpen}
        onClose={reportModal.onClose}
        title="举报小喇叭"
        subject="举报这条小喇叭。"
        target={{ targetType: 'shoutbox', targetId: shoutboxId }}
        // 举报可能触发阈值自动隐藏，提交后刷新公开列表
        onSubmitted={() => void notifyShoutboxPublicWrite(shoutboxQuery)}
      />

      <CaseLoginPrompt
        isOpen={loginModal.isOpen}
        onOpenChange={loginModal.onOpenChange}
        action="举报小喇叭"
      />
    </>
  )
}
