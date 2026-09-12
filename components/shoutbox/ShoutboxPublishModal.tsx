'use client'

import Link from 'next/link'
import { Button } from '@heroui/button'
import { Modal, ModalBody, ModalContent, ModalHeader } from '@heroui/modal'
import { useMounted } from '~/hooks/useMounted'
import { useUserStore } from '~/store/userStore'
import {
  ShoutboxPublishForm,
  type ShoutboxPickedPatch
} from './ShoutboxPublishForm'
import type { ShoutboxItem } from '~/types/api/shoutbox'

/**
 * Administrator-only (role >= 3, super admins included) entry into the
 * dashboard official-message form. Official messages are free and skip the
 * 50-point balance gate; choosing the important level there also renders a
 * site-wide banner. This is pure UX gating — the API re-checks the role.
 * Rendered only after mount because the role comes from the persisted user
 * store and must not drift during hydration.
 */
export const ShoutboxOfficialEntry = () => {
  const mounted = useMounted()
  const role = useUserStore((state) => state.user.role)
  if (!mounted || role < 3) {
    return null
  }
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-primary-200 bg-primary-50 px-3 py-2">
      <p className="min-w-40 flex-1 text-xs text-default-600">
        管理员可免费发布官方公告（不消耗萌萌点）；在后台选择「重要级（全站横幅）」可发布全站通知
      </p>
      <Button
        as={Link}
        href="/dashboard/shoutbox?tab=official"
        size="sm"
        color="primary"
        variant="flat"
      >
        发布官方公告
      </Button>
    </div>
  )
}

interface PublishModalProps {
  isOpen: boolean
  onOpenChange: (open: boolean) => void
  presetPatch?: ShoutboxPickedPatch | null
  lockPatchSelection?: boolean
  onPublished: (item: ShoutboxItem) => void
}

/**
 * Shared paid-publish modal used by the home module and the shoutbox pages:
 * the existing ShoutboxPublishForm (balance, errors, idempotency, optional
 * game link, 5-minute edit hint) plus the administrator official entry.
 */
export const ShoutboxPublishModal = ({
  isOpen,
  onOpenChange,
  presetPatch = null,
  lockPatchSelection = false,
  onPublished
}: PublishModalProps) => {
  return (
    <Modal
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      placement="center"
      scrollBehavior="inside"
    >
      <ModalContent>
        <ModalHeader>发布小喇叭</ModalHeader>
        <ModalBody className="pb-6">
          <ShoutboxOfficialEntry />
          <ShoutboxPublishForm
            key={presetPatch?.id ?? 'none'}
            presetPatch={presetPatch}
            lockPatchSelection={lockPatchSelection}
            onPublished={onPublished}
          />
        </ModalBody>
      </ModalContent>
    </Modal>
  )
}

interface LoginModalProps {
  isOpen: boolean
  onOpenChange: (open: boolean) => void
}

/** Guest prompt shown instead of the publish form when not logged in. */
export const ShoutboxLoginModal = ({
  isOpen,
  onOpenChange
}: LoginModalProps) => {
  return (
    <Modal isOpen={isOpen} onOpenChange={onOpenChange} placement="center">
      <ModalContent>
        <ModalHeader>请先登录</ModalHeader>
        <ModalBody className="pb-6">
          <p className="text-sm text-default-500">发布小喇叭需要先登录账号。</p>
          <div className="mt-3 flex gap-2">
            <Button as={Link} href="/login" color="primary">
              登录
            </Button>
            <Button as={Link} href="/register" variant="bordered">
              注册
            </Button>
          </div>
        </ModalBody>
      </ModalContent>
    </Modal>
  )
}
