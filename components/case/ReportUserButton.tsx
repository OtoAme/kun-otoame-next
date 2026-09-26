'use client'

import { Button, useDisclosure } from '@heroui/react'
import { Flag } from 'lucide-react'
import { useUserStore } from '~/store/userStore'
import { CaseLoginPrompt } from './CaseLoginPrompt'
import { CaseViolationReportModal } from './CaseViolationReportModal'

interface Props {
  targetUserId: number
  targetUserName: string
}

export const ReportUserButton = ({ targetUserId, targetUserName }: Props) => {
  const { user } = useUserStore((state) => state)
  const report = useDisclosure()
  const login = useDisclosure()

  if (user.uid === targetUserId) {
    return null
  }

  return (
    <>
      <Button
        variant="flat"
        color="danger"
        fullWidth
        startContent={<Flag className="size-4" />}
        onPress={user.uid < 1 ? login.onOpen : report.onOpen}
      >
        举报
      </Button>

      <CaseViolationReportModal
        isOpen={report.isOpen}
        onClose={report.onClose}
        title="举报用户"
        subject={`举报 ${targetUserName} 的违规行为。`}
        target={{ targetType: 'user', targetId: targetUserId }}
      />

      <CaseLoginPrompt
        isOpen={login.isOpen}
        onOpenChange={login.onOpenChange}
        action="举报"
      />
    </>
  )
}
