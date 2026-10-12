'use client'

import { useState } from 'react'
import {
  Button,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  useDisclosure
} from '@heroui/react'
import toast from 'react-hot-toast'
import { kunFetchPost } from '~/utils/kunFetch'
import type { PatchResourceLink } from '~/types/api/patch'
import type { LinkHealthMutationResponse } from '~/types/api/linkHealth'
import {
  buildLinkBasis,
  isLinkConflictError,
  readLinkHealth
} from './linkHealthDisplay'
import {
  linkHealthActionConfirmText,
  linkHealthActionLabel,
  linkHealthActionRequest,
  type LinkHealthPendingAction as PendingAction
} from '~/components/case/linkHealthActionFlow'

interface Props {
  patchId: number
  resourceId: number
  link: PatchResourceLink
  /** 补链 opens the existing resource editor focused at this link's address. */
  onRelink?: () => void
  onChanged?: (view: LinkHealthMutationResponse['link']) => void
}

/**
 * 归属方 / 站方 link-health actions, driven only by server capabilities.
 * Every action confirms first, posts the full expectation basis, and surfaces
 * named 409 vocabulary without any silent refresh-resubmit.
 */
export const LinkHealthActions = ({
  patchId,
  resourceId,
  link,
  onRelink,
  onChanged
}: Props) => {
  const health = readLinkHealth(link)
  const confirm = useDisclosure()
  const [pending, setPending] = useState<PendingAction | null>(null)
  const [submitting, setSubmitting] = useState(false)

  if (!health) {
    return null
  }
  const { capabilities } = health
  const hasAction =
    capabilities.ownerActions.length > 0 ||
    capabilities.resolveActions.length > 0 ||
    capabilities.canCheck ||
    (capabilities.canEdit && !!onRelink)
  if (!hasAction) {
    return null
  }

  const openConfirm = (action: PendingAction) => {
    setPending(action)
    confirm.onOpen()
  }

  const handleConfirm = async () => {
    if (!pending) return
    const basis = buildLinkBasis(patchId, resourceId, link)
    if (!basis) {
      toast.error('页面数据不是最新版本，请刷新后重试')
      return
    }
    setSubmitting(true)
    try {
      const { url, body } = linkHealthActionRequest(pending, basis)
      const res = await kunFetchPost<LinkHealthMutationResponse | string>(
        url,
        body
      )

      if (typeof res === 'string') {
        // 409 版本/状态/冷却与资格错误：明示并保留现状，不自动重试。
        toast.error(res || '操作失败，请稍后重试')
        if (isLinkConflictError(res)) {
          confirm.onClose()
        }
        return
      }
      onChanged?.(res.link)
      toast.success(pending.kind === 'check' ? '检测完成' : '已提交')
      confirm.onClose()
    } catch {
      toast.error('网络错误，操作失败，请重试')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <>
      <div className="flex flex-wrap gap-2">
        {capabilities.ownerActions.includes('verify') && (
          <Button
            size="sm"
            variant="flat"
            onPress={() => openConfirm({ kind: 'verify' })}
          >
            {linkHealthActionLabel({ kind: 'verify' })}
          </Button>
        )}
        {capabilities.ownerActions.includes('confirm_broken') && (
          <Button
            size="sm"
            variant="flat"
            color="danger"
            onPress={() => openConfirm({ kind: 'confirm_broken' })}
          >
            {linkHealthActionLabel({ kind: 'confirm_broken' })}
          </Button>
        )}
        {capabilities.resolveActions.map((action) => (
          <Button
            key={action}
            size="sm"
            variant="flat"
            color={action === 'broken' ? 'danger' : 'primary'}
            onPress={() => openConfirm({ kind: 'resolve', action })}
          >
            {linkHealthActionLabel({ kind: 'resolve', action })}
          </Button>
        ))}
        {capabilities.canCheck && (
          <Button
            size="sm"
            variant="flat"
            onPress={() => openConfirm({ kind: 'check' })}
          >
            {linkHealthActionLabel({ kind: 'check' })}
          </Button>
        )}
        {capabilities.canEdit && onRelink && (
          <Button size="sm" variant="flat" color="primary" onPress={onRelink}>
            补链
          </Button>
        )}
      </div>

      <Modal
        isOpen={confirm.isOpen}
        onClose={confirm.onClose}
        placement="center"
        isDismissable={!submitting}
        isKeyboardDismissDisabled={submitting}
        hideCloseButton={submitting}
      >
        <ModalContent>
          <ModalHeader>
            {pending ? linkHealthActionLabel(pending) : '确认操作'}
          </ModalHeader>
          <ModalBody>
            <p className="text-sm">
              {pending ? linkHealthActionConfirmText(pending) : ''}
            </p>
          </ModalBody>
          <ModalFooter>
            <Button
              variant="light"
              onPress={confirm.onClose}
              isDisabled={submitting}
            >
              取消
            </Button>
            <Button
              color="primary"
              onPress={() => void handleConfirm()}
              isLoading={submitting}
              isDisabled={submitting}
            >
              确认
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </>
  )
}
