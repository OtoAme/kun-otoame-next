'use client'

import { useRef, useState } from 'react'
import Link from 'next/link'
import toast from 'react-hot-toast'
import { Button } from '~/components/dashboard/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from '~/components/dashboard/ui/card'
import { Input } from '~/components/dashboard/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '~/components/dashboard/ui/select'
import { Textarea } from '~/components/dashboard/ui/textarea'
import { SHOUTBOX_OFFICIAL_DEFAULT_DURATION_MS } from '~/constants/shoutbox'
import { kunFetchPost } from '~/utils/kunFetch'
import { generateUUID } from '~/utils/random'
import { normalizeShoutboxContent } from '~/utils/shoutboxContent'
import type { ShoutboxLevel } from '~/constants/shoutbox'
import type { ShoutboxItem } from '~/types/api/shoutbox'

const pad = (value: number) => String(value).padStart(2, '0')

/** datetime-local input value in the browser's local timezone. */
export const toLocalDateTimeInput = (date: Date) =>
  `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`

interface Props {
  onPublished: () => void
}

export const ShoutboxOfficialForm = ({ onPublished }: Props) => {
  const [content, setContent] = useState('')
  const [level, setLevel] = useState<ShoutboxLevel>('normal')
  const [effectiveFrom, setEffectiveFrom] = useState(() =>
    toLocalDateTimeInput(new Date())
  )
  const [effectiveTo, setEffectiveTo] = useState(() =>
    toLocalDateTimeInput(
      new Date(Date.now() + SHOUTBOX_OFFICIAL_DEFAULT_DURATION_MS)
    )
  )
  const [link, setLink] = useState('')
  const [requestId, setRequestId] = useState(() => generateUUID())
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const lockRef = useRef(false)

  const reset = () => {
    setContent('')
    setLevel('normal')
    setEffectiveFrom(toLocalDateTimeInput(new Date()))
    setEffectiveTo(
      toLocalDateTimeInput(
        new Date(Date.now() + SHOUTBOX_OFFICIAL_DEFAULT_DURATION_MS)
      )
    )
    setLink('')
    setRequestId(generateUUID())
    setError('')
  }

  const handleSubmit = async () => {
    const trimmed = content.trim()
    if (!trimmed) {
      setError('官方消息正文不能为空')
      return
    }
    if (trimmed.length > 200) {
      setError('官方消息正文不能超过 200 个字符')
      return
    }
    const fromDate = new Date(effectiveFrom)
    const toDate = new Date(effectiveTo)
    if (Number.isNaN(fromDate.getTime()) || Number.isNaN(toDate.getTime())) {
      setError('请填写有效的生效起止时间')
      return
    }
    if (toDate.getTime() <= fromDate.getTime()) {
      setError('生效结束时间必须晚于开始时间')
      return
    }
    if (lockRef.current) {
      return
    }
    lockRef.current = true
    setSubmitting(true)
    setError('')
    try {
      const result = await kunFetchPost<ShoutboxItem | string>(
        '/admin/shoutbox',
        {
          requestId,
          content: trimmed,
          level,
          effectiveFrom: fromDate.toISOString(),
          effectiveTo: toDate.toISOString(),
          link: link.trim()
        }
      )
      if (typeof result === 'string') {
        setError(result || '发布失败，请稍后重试')
        return
      }
      toast.success('官方消息已发布')
      reset()
      onPublished()
    } catch {
      // Result unknown: keep the form and the same requestId so resubmitting
      // retries the original request instead of publishing twice.
      setError('发布结果未知，请稍后重试；重试不会重复发布')
    } finally {
      lockRef.current = false
      setSubmitting(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>发布官方消息</CardTitle>
        <CardDescription>
          重要级消息在生效期内会同时显示为全站顶部横幅；时效性通知写在这里，长说明请放到
          <Link
            href="/doc"
            className="text-primary underline underline-offset-4"
          >
            帮助文档
          </Link>
          并把链接填到下方。
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <Textarea
          aria-label="官方消息正文"
          placeholder="官方消息正文（200 字以内）"
          value={content}
          onChange={(event) =>
            setContent(normalizeShoutboxContent(event.target.value))
          }
          maxLength={200}
          disabled={submitting}
        />
        <div className="flex flex-wrap items-center gap-2">
          <Select
            value={level}
            onValueChange={(value) => setLevel(value as ShoutboxLevel)}
            disabled={submitting}
          >
            <SelectTrigger className="w-[140px]" aria-label="消息级别">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="normal">普通级</SelectItem>
              <SelectItem value="important">重要级（全站横幅）</SelectItem>
            </SelectContent>
          </Select>
          <label className="flex items-center gap-1 text-sm text-muted-foreground">
            生效开始
            <Input
              type="datetime-local"
              aria-label="生效开始时间"
              value={effectiveFrom}
              onChange={(event) => setEffectiveFrom(event.target.value)}
              disabled={submitting}
              className="w-auto"
            />
          </label>
          <label className="flex items-center gap-1 text-sm text-muted-foreground">
            生效结束
            <Input
              type="datetime-local"
              aria-label="生效结束时间"
              value={effectiveTo}
              onChange={(event) => setEffectiveTo(event.target.value)}
              disabled={submitting}
              className="w-auto"
            />
          </label>
        </div>
        <Input
          aria-label="详情链接"
          placeholder="详情链接（可选，站内长文档地址）"
          value={link}
          onChange={(event) => setLink(event.target.value)}
          disabled={submitting}
        />
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs text-muted-foreground">
            {content.trim().length} / 200
          </p>
          <Button onClick={() => void handleSubmit()} disabled={submitting}>
            {submitting ? '发布中…' : '发布官方消息'}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
