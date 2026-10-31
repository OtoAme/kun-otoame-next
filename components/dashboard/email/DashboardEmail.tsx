'use client'

import { useMemo, useRef, useState } from 'react'
import toast from 'react-hot-toast'
import { Loader2, Mail } from 'lucide-react'

import {
  DashboardPage,
  DashboardPanel
} from '~/components/dashboard/page/DashboardPage'
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from '~/components/dashboard/ui/alert-dialog'
import { Button } from '~/components/dashboard/ui/button'
import { Input } from '~/components/dashboard/ui/input'
import { Label } from '~/components/dashboard/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '~/components/dashboard/ui/select'
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger
} from '~/components/dashboard/ui/tabs'
import { Textarea } from '~/components/dashboard/ui/textarea'
import { emailTemplates } from '~/constants/email/group-templates'
import { kunFetchPost } from '~/utils/kunFetch'

// Typed confirmation for a send that reaches every subscribed user.
const CONFIRM_PHRASE = '发送'

const fill = (template: string, variables: Record<string, string>) =>
  Object.entries(variables).reduce(
    (content, [key, value]) => content.replaceAll(`{{${key}}}`, value),
    template
  )

/**
 * Admin-written HTML is previewed in a sandbox without scripts or same-origin
 * access, so pasted markup cannot act as the console page.
 */
function Preview({ html, className }: { html: string; className?: string }) {
  return (
    <iframe
      title="邮件预览"
      sandbox=""
      srcDoc={html}
      className={className ?? 'h-[560px] w-full rounded-lg border bg-white'}
    />
  )
}

export function DashboardEmail() {
  const [templateId, setTemplateId] = useState(emailTemplates[0]?.id ?? '')
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [typed, setTyped] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inflight = useRef(false)

  const template = emailTemplates.find((item) => item.id === templateId)
  const variables = { title, content }
  const preview = useMemo(
    () => (template ? fill(template.template, { title, content }) : ''),
    [template, title, content]
  )
  const ready = Boolean(template && title.trim() && content.trim())

  const send = async () => {
    if (inflight.current || !ready || typed !== CONFIRM_PHRASE) return
    inflight.current = true
    setSending(true)
    setError(null)
    try {
      const res = await kunFetchPost<{ count: number } | string>(
        '/admin/mail',
        { templateId, variables }
      )
      if (typeof res === 'string') {
        setError(res || '发送失败，请稍后重试')
        return
      }
      toast.success(`已向 ${res.count} 位开启邮件通知的用户发送`)
      setConfirmOpen(false)
      setTyped('')
      setTitle('')
      setContent('')
    } catch {
      // A partial send cannot be undone or safely repeated blindly.
      setError(
        '网络错误，发送结果未知，可能已部分发出。请先查看管理日志确认，再决定是否重发。'
      )
    } finally {
      inflight.current = false
      setSending(false)
    }
  }

  return (
    <DashboardPage title="邮件群发" description="发给全部开启邮件通知的用户。">
      <div className="grid min-w-0 items-start gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
        <DashboardPanel className="flex flex-col gap-4 p-5">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="email-template">模板</Label>
            <Select value={templateId} onValueChange={setTemplateId}>
              <SelectTrigger id="email-template" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {emailTemplates.map((item) => (
                  <SelectItem key={item.id} value={item.id}>
                    {item.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="email-title">标题</Label>
            <Input
              id="email-title"
              value={title}
              maxLength={200}
              placeholder="邮件标题"
              onChange={(event) => setTitle(event.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="email-content">内容</Label>
            <Textarea
              id="email-content"
              value={content}
              placeholder="支持 HTML。可以先在富文本编辑器里排版，再粘贴其输出的 HTML。"
              onChange={(event) => setContent(event.target.value)}
              className="min-h-64 font-mono text-sm"
            />
          </div>
          <Button
            className="self-start"
            disabled={!ready}
            onClick={() => {
              setError(null)
              setConfirmOpen(true)
            }}
          >
            <Mail />
            向全体用户发送
          </Button>
          {!ready && (
            <p className="text-xs text-muted-foreground">
              选择模板并填写标题和内容后才能发送。
            </p>
          )}
        </DashboardPanel>

        <DashboardPanel className="min-w-0 p-4">
          <Tabs defaultValue="preview">
            <TabsList>
              <TabsTrigger value="preview">预览</TabsTrigger>
              <TabsTrigger value="html">HTML</TabsTrigger>
            </TabsList>
            <TabsContent value="preview" className="mt-3">
              <Preview html={preview} />
            </TabsContent>
            <TabsContent value="html" className="mt-3">
              <pre className="max-h-[560px] overflow-auto rounded-lg border bg-muted/40 p-3 font-mono text-xs break-all whitespace-pre-wrap">
                {preview}
              </pre>
            </TabsContent>
          </Tabs>
        </DashboardPanel>
      </div>

      <AlertDialog
        open={confirmOpen}
        onOpenChange={(open) => {
          if (inflight.current) return
          setConfirmOpen(open)
          if (!open) setTyped('')
        }}
      >
        <AlertDialogContent className="sm:max-w-2xl">
          <AlertDialogHeader>
            <AlertDialogTitle>向全体用户发送这封邮件？</AlertDialogTitle>
            <AlertDialogDescription>
              邮件会发给所有开启邮件通知的用户，发出后无法撤回。请再核对一遍预览，然后输入「
              {CONFIRM_PHRASE}」确认。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <Preview
            html={preview}
            className="h-72 w-full rounded-lg border bg-white"
          />
          <Input
            aria-label={`输入「${CONFIRM_PHRASE}」确认`}
            value={typed}
            placeholder={CONFIRM_PHRASE}
            disabled={sending}
            onChange={(event) => setTyped(event.target.value)}
          />
          {sending && (
            <p className="text-sm text-muted-foreground">
              正在发送，耗时取决于用户数量和邮件服务状况，请不要关闭页面。
            </p>
          )}
          {error && (
            <p
              role="alert"
              className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive"
            >
              {error}
            </p>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={sending}>取消</AlertDialogCancel>
            <Button
              disabled={sending || typed !== CONFIRM_PHRASE}
              onClick={send}
            >
              {sending && <Loader2 className="animate-spin" />}
              {sending ? '发送中…' : '确认发送'}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </DashboardPage>
  )
}
