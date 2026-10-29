'use client'

import { useEffect, useRef, useState } from 'react'
import { Button } from '@heroui/button'
import { Chip } from '@heroui/chip'
import { Textarea } from '@heroui/input'
import { Flag, Pencil, Trash2, X } from 'lucide-react'
import toast from 'react-hot-toast'
import { generateUUID } from '~/utils/random'
import type { CaseViolationTarget } from '~/components/case/CaseViolationReportModal'
import { HELP_REPLY_MAX_LENGTH } from '~/constants/help'
import { kunFetchDelete, kunFetchPost, kunFetchPut } from '~/utils/kunFetch'
import { formatTimeDifference } from '~/utils/time'
import { HelpUserLink } from './HelpUserLink'
import type { HelpReply, HelpUser } from '~/types/api/help'

interface Props {
  answerId: number
  answerAuthor: HelpUser | null
  replies: HelpReply[]
  /**
   * Bumped by the answer's own「回复」button: opens the composer aimed at the
   * answer author. Replies inside the thread aim at their own author.
   */
  composeSignal: number
  /** False while the post or answer is hidden, or for guests. */
  canReply: boolean
  isAdmin: boolean
  onRequireLogin: () => boolean
  onChanged: () => Promise<void>
  onReport: (
    target: CaseViolationTarget,
    title: string,
    subject: string
  ) => void
}

const newRequestId = () => generateUUID()

/**
 * One level of replies under an answer (楼中楼). Replies are plain text; a
 * reply may name whom it answers, which the server keeps only when that user
 * already took part in this thread.
 */
export const HelpReplyThread = ({
  answerId,
  answerAuthor,
  replies,
  composeSignal,
  canReply,
  isAdmin,
  onRequireLogin,
  onChanged,
  onReport
}: Props) => {
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')
  const [replyTo, setReplyTo] = useState<HelpUser | null>(null)
  const [busy, setBusy] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editText, setEditText] = useState('')
  const requestIdRef = useRef(newRequestId())
  // Synchronous guard: two presses inside one render both see the old state.
  const lockRef = useRef(false)
  const lock = () => {
    if (lockRef.current) return false
    lockRef.current = true
    setBusy(true)
    return true
  }
  const unlock = () => {
    lockRef.current = false
    setBusy(false)
  }

  const openComposer = (target: HelpUser | null) => {
    if (!onRequireLogin()) return
    setReplyTo(target)
    setOpen(true)
  }

  useEffect(() => {
    if (composeSignal > 0) {
      setReplyTo(answerAuthor)
      setOpen(true)
    }
    // Only a new press of the answer's 回复 button reopens the composer.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [composeSignal])

  const submit = async () => {
    const content = text.trim()
    if (!content || !lock()) return
    try {
      const res = await kunFetchPost<{ replyId: number } | string>(
        '/help/reply',
        {
          answerId,
          requestId: requestIdRef.current,
          content,
          replyToUserId: replyTo?.id ?? null
        }
      )
      if (typeof res === 'string') {
        toast.error(res)
        requestIdRef.current = newRequestId()
        return
      }
      setText('')
      setReplyTo(null)
      setOpen(false)
      requestIdRef.current = newRequestId()
      await onChanged()
    } catch {
      // Keep the request id so a retry returns the reply if it was saved.
      toast.error('网络错误，请稍后重试')
    } finally {
      unlock()
    }
  }

  const saveEdit = async (replyId: number) => {
    const content = editText.trim()
    if (!content || !lock()) return
    try {
      const res = await kunFetchPut<{ replyId: number } | string>(
        '/help/reply',
        { replyId, content }
      )
      if (typeof res === 'string') {
        toast.error(res)
        return
      }
      setEditingId(null)
      await onChanged()
    } catch {
      toast.error('网络错误，请稍后重试')
    } finally {
      unlock()
    }
  }

  const remove = async (replyId: number) => {
    if (lockRef.current || !window.confirm('确定删除这条回复吗？')) return
    if (!lock()) return
    try {
      const res = await kunFetchDelete<{ replyId: number } | string>(
        '/help/reply',
        { replyId }
      )
      if (typeof res === 'string') {
        toast.error(res)
        return
      }
      await onChanged()
    } catch {
      toast.error('网络错误，请稍后重试')
    } finally {
      unlock()
    }
  }

  if (!replies.length && !open) return null

  return (
    <div className="space-y-2 rounded-medium bg-default-50 p-3">
      {replies.map((reply) => (
        <div
          key={reply.id}
          id={`reply-${reply.id}`}
          className="flex gap-2 border-b border-default-100 pb-2 last:border-b-0 last:pb-0"
        >
          <div className="min-w-0 flex-1 space-y-1">
            <div className="flex flex-wrap items-center gap-x-2 text-xs text-default-500">
              <HelpUserLink
                user={reply.user}
                avatar="xs"
                nameClassName="font-medium text-default-700"
              />
              {reply.replyTo && (
                <span className="inline-flex items-center gap-1">
                  回复
                  <HelpUserLink
                    user={reply.replyTo}
                    avatar="none"
                    nameClassName="text-default-700"
                  />
                </span>
              )}
              <span>{formatTimeDifference(reply.created)}</span>
              {reply.hidden && (
                <Chip size="sm" color="danger" variant="flat">
                  已被隐藏
                </Chip>
              )}
            </div>
            {editingId === reply.id ? (
              <div className="space-y-2">
                <Textarea
                  aria-label="编辑回复"
                  minRows={2}
                  maxLength={HELP_REPLY_MAX_LENGTH}
                  value={editText}
                  onValueChange={setEditText}
                />
                <div className="flex justify-end gap-2">
                  <Button
                    size="sm"
                    variant="flat"
                    onPress={() => setEditingId(null)}
                  >
                    取消
                  </Button>
                  <Button
                    size="sm"
                    color="primary"
                    isLoading={busy}
                    isDisabled={!editText.trim()}
                    onPress={() => saveEdit(reply.id)}
                  >
                    保存
                  </Button>
                </div>
              </div>
            ) : (
              <p className="whitespace-pre-wrap break-words text-sm">
                {reply.content}
              </p>
            )}
            <div className="flex flex-wrap gap-1">
              {canReply && !reply.canEdit && reply.user && (
                <Button
                  size="sm"
                  variant="light"
                  className="h-6 min-w-0 px-2 text-xs"
                  onPress={() => openComposer(reply.user)}
                >
                  回复
                </Button>
              )}
              {reply.canEdit && editingId !== reply.id && (
                <>
                  <Button
                    size="sm"
                    variant="light"
                    className="h-6 min-w-0 px-2 text-xs"
                    startContent={<Pencil className="size-3" />}
                    onPress={() => {
                      setEditingId(reply.id)
                      setEditText(reply.content)
                    }}
                  >
                    编辑
                  </Button>
                  <Button
                    size="sm"
                    variant="light"
                    color="danger"
                    className="h-6 min-w-0 px-2 text-xs"
                    startContent={<Trash2 className="size-3" />}
                    onPress={() => remove(reply.id)}
                  >
                    删除
                  </Button>
                </>
              )}
              {!reply.canEdit && !isAdmin && (
                <Button
                  size="sm"
                  variant="light"
                  className="h-6 min-w-0 px-2 text-xs"
                  startContent={<Flag className="size-3" />}
                  onPress={() =>
                    onReport(
                      { targetType: 'help_reply', targetId: reply.id },
                      '举报回复',
                      `${reply.user?.name ?? '已注销用户'}的回复`
                    )
                  }
                >
                  举报
                </Button>
              )}
            </div>
          </div>
        </div>
      ))}

      {canReply && open && (
        <div className="space-y-2">
          {replyTo && (
            <p className="flex items-center gap-1 text-xs text-default-500">
              <span>
                回复{' '}
                <HelpUserLink
                  user={replyTo}
                  avatar="none"
                  className="inline"
                  nameClassName="text-default-700"
                />
              </span>
            </p>
          )}
          <Textarea
            aria-label="写回复"
            autoFocus
            minRows={2}
            maxLength={HELP_REPLY_MAX_LENGTH}
            placeholder="追问或补充，纯文字"
            value={text}
            onValueChange={setText}
            description={`${text.trim().length}/${HELP_REPLY_MAX_LENGTH}`}
          />
          <div className="flex justify-end gap-2">
            <Button
              size="sm"
              variant="flat"
              startContent={<X className="size-3.5" />}
              onPress={() => setOpen(false)}
            >
              取消
            </Button>
            <Button
              size="sm"
              color="primary"
              isLoading={busy}
              isDisabled={!text.trim()}
              onPress={submit}
            >
              发布回复
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
