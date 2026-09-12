'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { Avatar } from '@heroui/avatar'
import { Button } from '@heroui/button'
import { Card, CardBody } from '@heroui/card'
import { Chip } from '@heroui/chip'
import { Textarea } from '@heroui/input'
import {
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  useDisclosure
} from '@heroui/modal'
import { Pencil, Trash2 } from 'lucide-react'
import toast from 'react-hot-toast'
import {
  SHOUTBOX_EDIT_WINDOW_MS,
  getShoutboxStatusLabel
} from '~/constants/shoutbox'
import { useMounted } from '~/hooks/useMounted'
import { kunFetchDelete, kunFetchPut } from '~/utils/kunFetch'
import { cn } from '~/utils/cn'
import { formatChinaDateTime } from '~/utils/fixedTimezoneDate'
import { normalizeShoutboxContent } from '~/utils/shoutboxContent'
import { formatTimeDifference } from '~/utils/time'
import { ShoutboxCompactRow } from './ShoutboxCompactRow'
import { ShoutboxReportButton } from './ShoutboxReportButton'
import type { ShoutboxItem } from '~/types/api/shoutbox'

interface Props {
  item: ShoutboxItem
  pinned?: boolean
  showStatus?: boolean
  highlight?: boolean
  /**
   * Compact single-row presentation for the public list pages (/shoutbox and
   * ?patch=), the home module, the per-game strip and the author record page:
   * the same author edit/delete logic riding on ShoutboxCompactRow. The
   * record page also passes showStatus so the row carries the status label
   * and the edited marker.
   */
  compact?: boolean
  /**
   * Compact mode only: set false where the surface must not gain a delete
   * entry (home module, per-game strip); the edit entry is unaffected.
   */
  showDelete?: boolean
  currentUserId: number
  onChanged?: (item: ShoutboxItem) => void
  onDeleted?: (id: number) => void
}

const isWithinEditWindow = (item: ShoutboxItem) =>
  !item.official &&
  item.status === 0 &&
  item.editedAt === null &&
  Date.now() - new Date(item.created).getTime() < SHOUTBOX_EDIT_WINDOW_MS

export const ShoutboxCard = ({
  item,
  pinned = false,
  showStatus = false,
  highlight = false,
  compact = false,
  showDelete = true,
  currentUserId,
  onChanged,
  onDeleted
}: Props) => {
  const mounted = useMounted()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(() =>
    normalizeShoutboxContent(item.content)
  )
  const [editError, setEditError] = useState('')
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [editable, setEditable] = useState(() => isWithinEditWindow(item))
  const deleteModal = useDisclosure()
  const actionLockRef = useRef(false)

  // The single 5-minute edit window closes while the page is open: flip the
  // entry off exactly at the deadline instead of waiting for the next render.
  useEffect(() => {
    if (!editable) {
      return
    }
    const deadline = new Date(item.created).getTime() + SHOUTBOX_EDIT_WINDOW_MS
    const delay = deadline - Date.now()
    if (delay <= 0) {
      setEditable(false)
      return
    }
    const timer = setTimeout(() => setEditable(false), delay)
    return () => clearTimeout(timer)
  }, [editable, item.created])

  // The author manages only their own user messages: one edit inside the
  // window while public; self-deletion stays available while the record is
  // public or hidden pending review. The item fields are re-checked on every
  // render so a successfully edited item (editedAt set) can never show the
  // edit entry again from this card.
  const isOwn = currentUserId > 0 && currentUserId === item.user.id
  const canEdit =
    isOwn &&
    !item.official &&
    item.status === 0 &&
    item.editedAt === null &&
    editable
  const canDelete =
    isOwn && !item.official && (item.status === 0 || item.status === 2)

  const handleStartEdit = () => {
    setDraft(normalizeShoutboxContent(item.content))
    setEditError('')
    setEditing(true)
  }

  const handleSaveEdit = async () => {
    const content = draft.trim()
    if (!content) {
      setEditError('小喇叭正文不能为空')
      return
    }
    if (content.length > 200) {
      setEditError('小喇叭正文不能超过 200 个字符')
      return
    }
    if (content === item.content) {
      setEditing(false)
      return
    }
    if (actionLockRef.current) {
      return
    }
    actionLockRef.current = true
    setSaving(true)
    try {
      const response = await kunFetchPut<KunResponse<ShoutboxItem>>(
        '/shoutbox',
        { shoutboxId: item.id, content }
      )
      if (typeof response === 'string') {
        toast.error(response)
        return
      }
      toast.success('小喇叭已更新')
      setEditing(false)
      // The one edit chance is spent: close local eligibility immediately
      // instead of relying on the parent swapping in the updated item.
      setEditable(false)
      onChanged?.(
        response && 'id' in response
          ? response
          : { ...item, content, editedAt: new Date().toISOString() }
      )
    } catch {
      toast.error('保存失败，请稍后重试')
    } finally {
      actionLockRef.current = false
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    if (actionLockRef.current) {
      return
    }
    actionLockRef.current = true
    setDeleting(true)
    try {
      const response = await kunFetchDelete<KunResponse<{}>>('/shoutbox', {
        shoutboxId: item.id
      })
      if (typeof response === 'string') {
        toast.error(response)
        return
      }
      toast.success('小喇叭已删除')
      deleteModal.onClose()
      onDeleted?.(item.id)
    } catch {
      toast.error('删除失败，请稍后重试')
    } finally {
      actionLockRef.current = false
      setDeleting(false)
    }
  }

  const editForm = (
    <div className="space-y-2">
      <Textarea
        aria-label="编辑小喇叭"
        value={draft}
        onValueChange={(value) => {
          setDraft(normalizeShoutboxContent(value))
          setEditError('')
        }}
        maxLength={200}
        isDisabled={saving}
        isInvalid={editError !== ''}
        errorMessage={editError}
        autoFocus
      />
      <div className="flex items-center justify-end gap-2">
        <span className="text-xs text-default-400">
          {draft.trim().length} / 200
        </span>
        <Button
          size="sm"
          variant="light"
          onPress={() => setEditing(false)}
          isDisabled={saving}
        >
          取消
        </Button>
        <Button
          size="sm"
          color="primary"
          onPress={handleSaveEdit}
          isLoading={saving}
        >
          保存
        </Button>
      </div>
    </div>
  )

  const deleteDialog = (
    <Modal
      isOpen={deleteModal.isOpen}
      onOpenChange={deleteModal.onOpenChange}
      placement="center"
    >
      <ModalContent>
        <ModalHeader>删除小喇叭</ModalHeader>
        <ModalBody>
          <p className="text-sm">
            确定要删除这条小喇叭吗？删除后不再公开显示，已消耗的萌萌点不会退回。
          </p>
        </ModalBody>
        <ModalFooter>
          <Button
            variant="light"
            onPress={deleteModal.onClose}
            isDisabled={deleting}
          >
            取消
          </Button>
          <Button color="danger" onPress={handleDelete} isLoading={deleting}>
            确认删除
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  )

  // Compact mode renders one row per message via ShoutboxCompactRow. The
  // author's edit/delete entries ride in its actions slot and keep the exact
  // same handlers, edit-window rules, draft retention and confirmation modal
  // as the full card. Editing swaps the row for the shared edit form in
  // place; the anchor id and the deep-link highlight stay on the wrapper.
  if (compact) {
    return (
      <div
        id={`shoutbox-${item.id}`}
        className={cn('rounded-lg', highlight && 'ring-2 ring-primary')}
      >
        {editing ? (
          <div className="px-2 py-2">{editForm}</div>
        ) : (
          <ShoutboxCompactRow
            item={item}
            pinned={pinned}
            showStatus={showStatus}
            allowsDelete={showDelete}
            actions={
              mounted && (canEdit || (canDelete && showDelete)) ? (
                <>
                  {canEdit && (
                    <Button
                      size="sm"
                      variant="light"
                      isIconOnly
                      aria-label="编辑"
                      onPress={handleStartEdit}
                    >
                      <Pencil className="size-3.5" />
                    </Button>
                  )}
                  {canDelete && showDelete && (
                    <Button
                      size="sm"
                      variant="light"
                      color="danger"
                      isIconOnly
                      aria-label="删除"
                      onPress={deleteModal.onOpen}
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  )}
                </>
              ) : null
            }
          />
        )}
        {deleteDialog}
      </div>
    )
  }

  return (
    <Card
      id={`shoutbox-${item.id}`}
      className={cn(
        'w-full',
        item.official && 'border-primary-300 bg-primary-50',
        highlight && 'ring-2 ring-primary'
      )}
    >
      <CardBody className="gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <Link
            href={`/user/${item.user.id}`}
            className="flex min-w-0 items-center gap-2 rounded-small"
          >
            <Avatar
              src={item.user.avatar}
              name={item.user.name}
              size="sm"
              className="shrink-0"
            />
            <span className="truncate text-small font-medium leading-6 hover:underline sm:text-base sm:leading-6">
              {item.user.name}
            </span>
          </Link>
          {pinned && (
            <Chip size="sm" color="primary" variant="bordered">
              置顶
            </Chip>
          )}
          {item.official && item.level === 'important' && (
            <Chip size="sm" color="danger" variant="bordered">
              重要
            </Chip>
          )}
          {showStatus && item.status !== 0 && (
            <Chip
              size="sm"
              variant="flat"
              color={
                item.status === 3
                  ? 'danger'
                  : item.status === 2
                    ? 'warning'
                    : 'default'
              }
            >
              {getShoutboxStatusLabel(item.status, item.official)}
            </Chip>
          )}
          {/* Deterministic Asia/Shanghai text for SSR and first hydration;
              the relative label only replaces it after mount. */}
          <time
            dateTime={item.created}
            className="ml-auto shrink-0 text-xs text-default-400"
          >
            {mounted
              ? formatTimeDifference(item.created)
              : formatChinaDateTime(item.created)}
            {item.editedAt ? ' · 已编辑' : ''}
          </time>
        </div>

        {editing ? (
          editForm
        ) : (
          <p className="whitespace-pre-wrap break-words text-small leading-6 sm:text-base sm:leading-6">
            {normalizeShoutboxContent(item.content)}
          </p>
        )}

        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          {item.patch && (
            <Link
              href={`/${item.patch.uniqueId}`}
              className="max-w-full truncate text-xs text-primary hover:underline"
            >
              《{item.patch.name}》
            </Link>
          )}
          {item.link ? (
            <Link
              href={item.link}
              className="text-xs text-primary hover:underline"
            >
              查看详情
            </Link>
          ) : null}
          {mounted && (canEdit || canDelete || !isOwn) && !editing && (
            <div className="ml-auto flex items-center gap-1">
              {canEdit && (
                <Button
                  size="sm"
                  variant="light"
                  startContent={<Pencil className="size-3.5" />}
                  onPress={handleStartEdit}
                >
                  编辑
                </Button>
              )}
              {canDelete && (
                <Button
                  size="sm"
                  variant="light"
                  color="danger"
                  startContent={<Trash2 className="size-3.5" />}
                  onPress={deleteModal.onOpen}
                >
                  删除
                </Button>
              )}
              {!isOwn && (
                <ShoutboxReportButton
                  shoutboxId={item.id}
                  authorId={item.user.id}
                  reportable={item.reportable}
                />
              )}
            </div>
          )}
        </div>
      </CardBody>

      {deleteDialog}
    </Card>
  )
}
