'use client'

import { useRef, useState } from 'react'
import Link from 'next/link'
import { CircleCheck, MessageSquarePlus } from 'lucide-react'

import { Button } from '~/components/dashboard/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger
} from '~/components/dashboard/ui/dialog'
import { Textarea } from '~/components/dashboard/ui/textarea'
import { kunFetchPost } from '~/utils/kunFetch'
import {
  CASE_CONTENT_MAX_LENGTH,
  CASE_DESCRIPTION_MIN_LENGTH,
  CASE_SITE_TARGET_ID
} from '~/constants/case'
import { useCaseImageUploads } from '~/components/case/useCaseImageUploads'
import type { CaseCreateResponse } from '~/types/api/case'

import { IssueImageField } from './IssueImageField'

interface IssueSiteFeedbackDialogProps {
  /** Runs after a successful submission so the list can refresh. */
  onSubmitted?: () => void
}

/**
 * 站务反馈（D21）：改名、恢复内容、账号与萌萌点等需要网站管理员改数据的
 * 请求，提交 `other × site`。同一用户同时只有一条未结站务反馈，再次提交会
 * 追加到那一条里。
 */
export function IssueSiteFeedbackDialog({
  onSubmitted
}: IssueSiteFeedbackDialogProps) {
  const uploads = useCaseImageUploads()
  const [open, setOpen] = useState(false)
  const [content, setContent] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [result, setResult] = useState<CaseCreateResponse | null>(null)
  const lockRef = useRef(false)
  const tooShort = content.trim().length < CASE_DESCRIPTION_MIN_LENGTH

  const handleOpenChange = (next: boolean) => {
    if (!next && submitting) return
    // 提交成功后收起即清空；取消时保留草稿
    if (!next && result) {
      setResult(null)
      setContent('')
      setError('')
      uploads.reset()
    }
    setOpen(next)
  }

  const handleSubmit = async () => {
    if (tooShort || uploads.uploading || lockRef.current) return
    lockRef.current = true
    setSubmitting(true)
    setError('')
    try {
      const res = await kunFetchPost<CaseCreateResponse | string>('/case', {
        kind: 'other',
        targetType: 'site',
        targetId: CASE_SITE_TARGET_ID,
        content: content.trim(),
        imageKeys: uploads.keys
      })
      if (typeof res === 'string') {
        setError(res || '提交失败，请稍后重试')
        return
      }
      if (res.justClosed) {
        setError('你的上一条站务反馈刚刚结案，请重新提交')
        return
      }
      setResult(res)
      onSubmitted?.()
    } catch {
      setError('网络错误，提交失败，请重试')
    } finally {
      lockRef.current = false
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button type="button" variant="outline" size="sm">
          <MessageSquarePlus className="size-4" aria-hidden />
          站务反馈
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[85dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>站务反馈</DialogTitle>
          <DialogDescription>
            改名、恢复内容、账号与萌萌点等需要网站管理员修改数据的请求写在这里。由网站管理员处理，不承诺首次响应时限；网站管理员能看到你的用户名和说明。
          </DialogDescription>
        </DialogHeader>

        {result ? (
          <div className="space-y-2">
            <p className="flex items-center gap-2 text-sm font-medium">
              <CircleCheck className="size-4" aria-hidden />
              {result.created ? '已提交' : '已补充到你之前的站务反馈'}
            </p>
            <p className="text-sm text-muted-foreground">
              {result.created
                ? '已交给网站管理员。处理进度会通过站内通知告诉你。'
                : '你还有一条站务反馈在处理中，这次写的内容已追加进去。'}
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            <label htmlFor="issue-site-feedback" className="sr-only">
              反馈内容
            </label>
            <Textarea
              id="issue-site-feedback"
              value={content}
              onChange={(event) => setContent(event.target.value)}
              maxLength={CASE_CONTENT_MAX_LENGTH}
              rows={5}
              disabled={submitting}
              placeholder={`需要网站管理员做什么，涉及的用户名、游戏或链接（至少 ${CASE_DESCRIPTION_MIN_LENGTH} 个字符，纯文字）`}
            />
            <IssueImageField uploads={uploads} disabled={submitting} />
            {error ? (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            ) : null}
          </div>
        )}

        <DialogFooter>
          {result ? (
            <>
              <Button
                type="button"
                variant="outline"
                onClick={() => handleOpenChange(false)}
              >
                关闭
              </Button>
              <Button asChild>
                <Link
                  href={`/issue?id=${result.case.id}`}
                  scroll={false}
                  onClick={() => handleOpenChange(false)}
                >
                  查看这条问题
                </Link>
              </Button>
            </>
          ) : (
            <>
              <Button
                type="button"
                variant="outline"
                disabled={submitting}
                onClick={() => handleOpenChange(false)}
              >
                取消
              </Button>
              <Button
                type="button"
                disabled={tooShort || submitting || uploads.uploading}
                onClick={() => void handleSubmit()}
              >
                {submitting ? '提交中…' : '提交'}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
