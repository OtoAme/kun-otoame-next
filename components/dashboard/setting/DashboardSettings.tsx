'use client'

import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import toast from 'react-hot-toast'
import { Loader2, Plus, X } from 'lucide-react'

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
import { Badge } from '~/components/dashboard/ui/badge'
import { Button } from '~/components/dashboard/ui/button'
import { Input } from '~/components/dashboard/ui/input'
import { Label } from '~/components/dashboard/ui/label'
import { Skeleton } from '~/components/dashboard/ui/skeleton'
import { Switch } from '~/components/dashboard/ui/switch'
import { kunFetchGet, kunFetchPut } from '~/utils/kunFetch'
import type { AdminRedirectConfig } from '~/types/api/admin'

const MAX_DOMAIN_LENGTH = 500

function RegisterSetting() {
  const [disabled, setDisabled] = useState<boolean | null>(null)
  const [error, setError] = useState('')
  const [pending, setPending] = useState<boolean | null>(null)
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    setError('')
    try {
      const res = await kunFetchGet<{ disableRegister: boolean } | string>(
        '/admin/setting/register'
      )
      if (typeof res === 'string') setError(res || '读取注册设置失败')
      else setDisabled(res.disableRegister)
    } catch {
      setError('网络错误，读取注册设置失败')
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  // Closing or opening registration affects every visitor, so it is
  // confirmed first; cancelling writes nothing.
  const apply = async (next: boolean) => {
    setSaving(true)
    try {
      const res = await kunFetchPut<Record<string, unknown> | string>(
        '/admin/setting/register',
        { disableRegister: next }
      )
      if (typeof res === 'string') {
        toast.error(res || '保存失败')
        return
      }
      setDisabled(next)
      toast.success(next ? '已关闭注册' : '已开放注册')
      setPending(null)
    } catch {
      toast.error('网络错误，保存结果未知，请刷新后核对')
    } finally {
      setSaving(false)
    }
  }

  return (
    <DashboardPanel className="p-5">
      <div className="flex items-start gap-4">
        <div className="min-w-0 flex-1">
          <Label htmlFor="setting-register" className="text-base">
            关闭注册
          </Label>
          <p className="mt-1 text-sm text-muted-foreground">
            开启后新用户无法注册，已有用户不受影响。
          </p>
          {error && (
            <p role="alert" className="mt-2 text-sm text-destructive">
              {error}{' '}
              <button
                type="button"
                className="underline underline-offset-4"
                onClick={() => void load()}
              >
                重试
              </button>
            </p>
          )}
        </div>
        {disabled === null ? (
          <Skeleton className="h-5 w-8 rounded-full" />
        ) : (
          <Switch
            id="setting-register"
            checked={disabled}
            disabled={saving}
            onCheckedChange={(next) => setPending(next)}
          />
        )}
      </div>
      <AlertDialog
        open={pending !== null}
        onOpenChange={(open) => {
          if (!open && !saving) setPending(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {pending ? '关闭新用户注册？' : '开放新用户注册？'}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {pending
                ? '关闭后注册页会提示暂停注册，直到重新开放。'
                : '开放后任何访客都可以注册新账号。'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={saving}>取消</AlertDialogCancel>
            <Button
              variant={pending ? 'destructive' : 'default'}
              disabled={saving}
              onClick={() => pending !== null && void apply(pending)}
            >
              {saving && <Loader2 className="animate-spin" />}
              {pending ? '关闭注册' : '开放注册'}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </DashboardPanel>
  )
}

function RedirectSetting() {
  const [saved, setSaved] = useState<AdminRedirectConfig | null>(null)
  const [draft, setDraft] = useState<AdminRedirectConfig | null>(null)
  const [error, setError] = useState('')
  const [domain, setDomain] = useState('')
  const [saving, setSaving] = useState(false)
  const inflight = useRef(false)

  const load = useCallback(async () => {
    setError('')
    try {
      const res = await kunFetchGet<AdminRedirectConfig | string>(
        '/admin/setting/redirect'
      )
      if (typeof res === 'string') {
        setError(res || '读取重定向设置失败')
        return
      }
      setSaved(res)
      setDraft(res)
    } catch {
      setError('网络错误，读取重定向设置失败')
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const dirty =
    saved !== null &&
    draft !== null &&
    JSON.stringify(saved) !== JSON.stringify(draft)

  const addDomain = (event: FormEvent) => {
    event.preventDefault()
    const value = domain.trim().replace(/^https?:\/\//, '')
    if (!value || !draft) return
    if (value.length > MAX_DOMAIN_LENGTH) {
      toast.error(`单个域名不能超过 ${MAX_DOMAIN_LENGTH} 个字符`)
      return
    }
    if (!draft.excludedDomains.includes(value)) {
      setDraft({ ...draft, excludedDomains: [...draft.excludedDomains, value] })
    }
    setDomain('')
  }

  const save = async () => {
    if (!draft || inflight.current) return
    if (!Number.isFinite(draft.delaySeconds) || draft.delaySeconds < 0) {
      toast.error('重定向等待时间需为不小于 0 的数字')
      return
    }
    inflight.current = true
    setSaving(true)
    try {
      const res = await kunFetchPut<Record<string, unknown> | string>(
        '/admin/setting/redirect',
        { ...draft }
      )
      if (typeof res === 'string') {
        // Keep the draft so nothing typed is lost.
        toast.error(res || '保存失败')
        return
      }
      setSaved(draft)
      toast.success('重定向设置已保存')
    } catch {
      toast.error('网络错误，保存结果未知，请刷新后核对')
    } finally {
      inflight.current = false
      setSaving(false)
    }
  }

  return (
    <DashboardPanel className="flex flex-col gap-5 p-5">
      <div className="flex items-start gap-4">
        <div className="min-w-0 flex-1">
          <Label htmlFor="setting-redirect" className="text-base">
            外链重定向
          </Label>
          <p className="mt-1 text-sm text-muted-foreground">
            开启后，排除列表之外的站外链接先进入跳转提示页，等待设定的秒数后再前往目标。
          </p>
        </div>
        {draft === null ? (
          <Skeleton className="h-5 w-8 rounded-full" />
        ) : (
          <Switch
            id="setting-redirect"
            checked={draft.enableRedirect}
            onCheckedChange={(enableRedirect) =>
              setDraft({ ...draft, enableRedirect })
            }
          />
        )}
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}{' '}
          <button
            type="button"
            className="underline underline-offset-4"
            onClick={() => void load()}
          >
            重试
          </button>
        </p>
      )}
      {draft && (
        <>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="setting-redirect-delay">等待时间</Label>
            <div className="flex items-center gap-2">
              <Input
                id="setting-redirect-delay"
                type="number"
                min={0}
                inputMode="numeric"
                className="w-28"
                value={String(draft.delaySeconds)}
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    delaySeconds: Number(event.target.value)
                  })
                }
              />
              <span className="text-sm text-muted-foreground">秒</span>
            </div>
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="setting-redirect-domain">排除域名</Label>
            <p className="text-sm text-muted-foreground">
              这些域名的链接直接打开，不经过跳转页。填写域名即可，不需要
              http://。
            </p>
            <form onSubmit={addDomain} className="flex max-w-md gap-2">
              <Input
                id="setting-redirect-domain"
                value={domain}
                placeholder="例如 store.steampowered.com"
                maxLength={MAX_DOMAIN_LENGTH}
                onChange={(event) => setDomain(event.target.value)}
              />
              <Button type="submit" variant="outline" disabled={!domain.trim()}>
                <Plus />
                添加
              </Button>
            </form>
            {draft.excludedDomains.length === 0 ? (
              <p className="text-sm text-muted-foreground">还没有排除域名。</p>
            ) : (
              <ul className="flex flex-wrap gap-1.5">
                {draft.excludedDomains.map((item) => (
                  <li key={item}>
                    <Badge variant="secondary" className="gap-1 pr-1">
                      {item}
                      <button
                        type="button"
                        aria-label={`移除排除域名 ${item}`}
                        className="rounded-sm p-0.5 hover:bg-background/60 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                        onClick={() =>
                          setDraft({
                            ...draft,
                            excludedDomains: draft.excludedDomains.filter(
                              (value) => value !== item
                            )
                          })
                        }
                      >
                        <X className="size-3" />
                      </button>
                    </Badge>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2 border-t pt-4">
            <Button onClick={save} disabled={!dirty || saving}>
              {saving && <Loader2 className="animate-spin" />}
              保存重定向设置
            </Button>
            <Button
              variant="outline"
              disabled={!dirty || saving}
              onClick={() => setDraft(saved)}
            >
              放弃改动
            </Button>
            {dirty && (
              <span className="text-sm text-amber-700 dark:text-amber-400">
                有未保存的改动
              </span>
            )}
          </div>
        </>
      )}
    </DashboardPanel>
  )
}

export function DashboardSettings() {
  return (
    <DashboardPage
      title="站点设置"
      description="重定向设置改完后点保存才生效。"
    >
      <div className="flex max-w-3xl flex-col gap-4">
        <RegisterSetting />
        <RedirectSetting />
      </div>
    </DashboardPage>
  )
}
