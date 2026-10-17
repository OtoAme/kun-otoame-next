'use client'

import { useEffect, useRef, useState } from 'react'
import {
  Button,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  useDisclosure
} from '@heroui/react'
import { Tooltip } from '@heroui/tooltip'
import { PenLine, ScanSearch } from 'lucide-react'
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
  readLinkHealthActionResponse,
  type LinkHealthPendingAction as PendingAction
} from '~/components/case/linkHealthActionFlow'
import {
  INVALID_LINK_CHECK_FEEDBACK,
  linkCheckFeedback
} from '~/components/case/linkCheckFeedback'

interface Props {
  patchId: number
  resourceId: number
  link: PatchResourceLink
  /** 补链 opens the existing resource editor focused at this link's address. */
  onRelink?: () => void
  onChanged?: (view: LinkHealthMutationResponse['link']) => void
  /**
   * `maintain` sits on the health row (检测 / 补链).
   * `decide` is the dashed 处理 strip (核实 / 确认失效 / 判定).
   */
  group: 'maintain' | 'decide'
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
  onChanged,
  group
}: Props) => {
  const health = readLinkHealth(link)
  const confirm = useDisclosure()
  const [pending, setPending] = useState<PendingAction | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const inFlight = useRef(false)
  const mounted = useRef(true)
  const current = useRef({ patchId, resourceId, link })
  current.current = { patchId, resourceId, link }
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  if (!health) {
    return null
  }
  const { capabilities } = health
  const canRelink = Boolean(capabilities.canEdit && onRelink)
  const hasMaintain = capabilities.canCheck || canRelink
  const hasDecide =
    capabilities.ownerActions.length > 0 ||
    capabilities.resolveActions.length > 0
  if (group === 'maintain' && !hasMaintain) {
    return null
  }
  if (group === 'decide' && !hasDecide) {
    return null
  }

  const openConfirm = (action: PendingAction) => {
    setPending(action)
    confirm.onOpen()
  }

  const handleConfirm = async () => {
    if (!pending || inFlight.current) return
    const isCurrent = () =>
      mounted.current &&
      current.current.patchId === patchId &&
      current.current.resourceId === resourceId &&
      current.current.link === link
    const basis = buildLinkBasis(patchId, resourceId, link)
    if (!basis) {
      toast.error('页面数据不是最新版本，请刷新后重试')
      return
    }
    inFlight.current = true
    setSubmitting(true)
    let accepted: LinkHealthMutationResponse | null = null
    try {
      const { url, body } = linkHealthActionRequest(pending, basis)
      const raw = await kunFetchPost<unknown>(url, body)

      if (!isCurrent()) return
      if (typeof raw === 'string') {
        // 409 版本/状态/冷却与资格错误：明示并保留现状，不自动重试。
        toast.error(raw || '操作失败，请稍后重试')
        if (isLinkConflictError(raw)) {
          confirm.onClose()
        }
        return
      }
      const res = readLinkHealthActionResponse(raw, basis)
      if (!res) {
        toast.error(INVALID_LINK_CHECK_FEEDBACK.message)
        return
      }
      const feedback =
        pending.kind === 'check'
          ? linkCheckFeedback(res)
          : { type: 'success' as const, message: '已提交' }
      if (feedback.type === 'info') toast(feedback.message)
      else toast[feedback.type](feedback.message)
      accepted = res
      confirm.onClose()
    } catch {
      if (isCurrent()) toast.error('网络错误，操作失败，请重试')
    } finally {
      inFlight.current = false
      if (mounted.current) setSubmitting(false)
    }
    if (accepted) onChanged?.(accepted.link)
  }

  return (
    <>
      {group === 'maintain' ? (
        <div className="flex items-center gap-0.5">
          {capabilities.canCheck && (
            <Tooltip content={linkHealthActionLabel({ kind: 'check' })}>
              <Button
                size="sm"
                variant="light"
                isIconOnly
                aria-label={linkHealthActionLabel({ kind: 'check' })}
                className="shrink-0"
                onPress={() => openConfirm({ kind: 'check' })}
              >
                <ScanSearch className="size-4" />
              </Button>
            </Tooltip>
          )}
          {canRelink && (
            <Tooltip content="补链">
              <Button
                size="sm"
                variant="light"
                isIconOnly
                aria-label="补链"
                className="shrink-0"
                onPress={onRelink}
              >
                <PenLine className="size-4" />
              </Button>
            </Tooltip>
          )}
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2 border-t border-dashed border-default-200 pt-2">
          <span className="text-[11px] font-medium tracking-wide text-default-400">
            处理
          </span>
          {capabilities.ownerActions.includes('verify') && (
            <Button
              size="sm"
              variant="bordered"
              onPress={() => openConfirm({ kind: 'verify' })}
            >
              {linkHealthActionLabel({ kind: 'verify' })}
            </Button>
          )}
          {capabilities.ownerActions.includes('confirm_broken') && (
            <Button
              size="sm"
              variant="bordered"
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
              variant="bordered"
              color={action === 'broken' ? 'danger' : 'primary'}
              onPress={() => openConfirm({ kind: 'resolve', action })}
            >
              {linkHealthActionLabel({ kind: 'resolve', action })}
            </Button>
          ))}
        </div>
      )}

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
