'use client'

import { useEffect, useId, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { Loader2, ShieldOff } from 'lucide-react'

import { Badge } from '~/components/dashboard/ui/badge'
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
import { Input } from '~/components/dashboard/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '~/components/dashboard/ui/select'
import { Separator } from '~/components/dashboard/ui/separator'
import { Textarea } from '~/components/dashboard/ui/textarea'
import { kunFetchPost, kunFetchPut } from '~/utils/kunFetch'
import { USER_ROLE_MAP } from '~/constants/user'
import { isValidEmail, isValidPassword } from '~/utils/validate'
import type { AdminUser } from '~/types/api/admin'

interface UserEditDialogProps {
  user: AdminUser
  onUpdated: (uid: number) => void
}

// Request payload kept in component memory only (no API runtime imports).
interface AdminUpdateUserPayload {
  uid: number
  name: string
  email: string
  role: number
  status: number
  dailyImageCount: number
  bio: string
  password?: string
}

interface UserSnapshot {
  uid: number
  role: number
}

type BusyAction = 'save' | '2fa' | null

export function UserEditDialog({ user, onUpdated }: UserEditDialogProps) {
  const fieldId = useId()

  const [open, setOpen] = useState(false)
  const [busyAction, setBusyAction] = useState<BusyAction>(null)
  const [error, setError] = useState('')

  const [name, setName] = useState(user.name)
  const [email, setEmail] = useState(user.email)
  const [role, setRole] = useState(user.role)
  const [status, setStatus] = useState(user.status)
  const [dailyImageCount, setDailyImageCount] = useState(
    String(user.dailyImageCount)
  )
  const [password, setPassword] = useState('')
  const [bio, setBio] = useState(user.bio ?? '')
  const [enable2FA, setEnable2FA] = useState(user.enable2FA)
  const [originalRole, setOriginalRole] = useState(user.role)
  const [snapshotUid, setSnapshotUid] = useState<number | null>(null)

  const snapshotRef = useRef<UserSnapshot | null>(null)
  const inflightRef = useRef(false)
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  const busy = busyAction !== null

  // If the row underneath this dialog switches to another user, close and
  // reset. An in-flight request keeps its captured payload and still reports
  // onUpdated() with the captured (old) uid when it settles.
  useEffect(() => {
    if (!open || snapshotUid === null || snapshotUid === user.id) {
      return
    }
    snapshotRef.current = null
    setSnapshotUid(null)
    setPassword('')
    setError('')
    setOpen(false)
  }, [open, user.id, snapshotUid])

  const resetDraft = (target: AdminUser) => {
    snapshotRef.current = { uid: target.id, role: target.role }
    setSnapshotUid(target.id)
    setOriginalRole(target.role)
    setName(target.name)
    setEmail(target.email)
    setRole(target.role)
    setStatus(target.status)
    setDailyImageCount(String(target.dailyImageCount))
    setPassword('')
    setBio(target.bio ?? '')
    setEnable2FA(target.enable2FA)
    setError('')
  }

  const clearAfterClose = () => {
    snapshotRef.current = null
    setSnapshotUid(null)
    setPassword('')
    setError('')
  }

  const handleOpenChange = (next: boolean) => {
    // Shared in-flight lock: ignore close / Escape / outside-click while busy.
    if (inflightRef.current) {
      return
    }
    if (next) {
      // Snapshot the CURRENT user only when the dialog opens; a later parent
      // refresh for the same id must not erase an in-progress draft.
      resetDraft(user)
      setOpen(true)
      return
    }
    setOpen(false)
    clearAfterClose()
  }

  const beginRequest = (action: Exclude<BusyAction, null>) => {
    if (inflightRef.current) {
      return false
    }
    // Synchronous lock set before any await so save and 2FA never overlap.
    inflightRef.current = true
    setBusyAction(action)
    return true
  }

  const endRequest = () => {
    inflightRef.current = false
    if (mountedRef.current) {
      setBusyAction(null)
    }
  }

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const snapshot = snapshotRef.current
    if (!snapshot || inflightRef.current) {
      return
    }
    const targetUid = snapshot.uid

    const trimmedName = name.trim()
    const trimmedEmail = email.trim()
    const trimmedPassword = password.trim()
    const trimmedBio = bio.trim()
    const dailyImageCountText = dailyImageCount.trim()

    if (trimmedName.length < 1 || trimmedName.length > 17) {
      setError('用户名长度需为 1~17 个字符')
      return
    }
    if (!trimmedEmail) {
      setError('邮箱不能为空')
      return
    }
    if (!isValidEmail(trimmedEmail)) {
      setError('请输入正确的邮箱地址')
      return
    }
    if (!dailyImageCountText) {
      setError('请输入今日已用图片次数')
      return
    }
    const parsedDailyImageCount = Number(dailyImageCountText)
    if (
      !Number.isInteger(parsedDailyImageCount) ||
      parsedDailyImageCount < 0 ||
      parsedDailyImageCount > 50
    ) {
      setError('今日已用图片次数需为 0~50 的整数')
      return
    }
    if (trimmedPassword && !isValidPassword(trimmedPassword)) {
      setError('密码需为 6~1007 位，且同时包含至少一个字母和一个数字')
      return
    }
    if (trimmedBio.length > 107) {
      setError('简介不能超过 107 字')
      return
    }

    const payload: AdminUpdateUserPayload = {
      uid: targetUid,
      name: trimmedName,
      email: trimmedEmail,
      role,
      status,
      dailyImageCount: parsedDailyImageCount,
      bio: trimmedBio
    }
    if (trimmedPassword) {
      payload.password = trimmedPassword
    }

    setError('')
    if (!beginRequest('save')) {
      return
    }

    try {
      const result = await kunFetchPut<Record<string, unknown>>('/admin/user', {
        ...payload
      })
      if (typeof result === 'string') {
        // Business error (any string, including empty): keep draft for retry.
        if (mountedRef.current) {
          setError(result || '更新用户失败，请稍后重试')
        }
        return
      }
    } catch {
      if (mountedRef.current) {
        setError('网络错误，请稍后重试')
      }
      return
    } finally {
      endRequest()
    }

    // Confirmed success: close locally first, then notify the parent outside
    // the network try/catch so a caller-side refresh exception is never
    // misreported as a write failure. Uses the uid captured at submit time;
    // the shared lock was already released in finally above.
    if (mountedRef.current) {
      setOpen(false)
      clearAfterClose()
    }
    onUpdated(targetUid)
  }

  const handleDisable2FA = async () => {
    const snapshot = snapshotRef.current
    if (!snapshot || !enable2FA || inflightRef.current) {
      return
    }
    const targetUid = snapshot.uid

    setError('')
    if (!beginRequest('2fa')) {
      return
    }

    try {
      const result = await kunFetchPost<Record<string, unknown>>(
        '/admin/user/2fa/disable',
        { uid: targetUid }
      )
      if (typeof result === 'string') {
        if (mountedRef.current) {
          setError(result || '关闭两步验证失败，请稍后重试')
        }
        return
      }
    } catch {
      if (mountedRef.current) {
        setError('网络错误，请稍后重试')
      }
      return
    } finally {
      endRequest()
    }

    // Confirmed success: flip only the local 2FA flag (all other unsaved
    // fields are kept), then notify the parent outside the network
    // try/catch so a caller-side refresh exception is never misreported
    // as a write failure. Uses the uid captured when the request started.
    if (mountedRef.current) {
      setEnable2FA(false)
    }
    onUpdated(targetUid)
  }

  const roleLabel = (value: number) => USER_ROLE_MAP[value] ?? `角色 ${value}`

  // Role 4 stays selectable only when the open-time snapshot already was
  // role 4 (never auto-demote); 1~3 users cannot be promoted to 4 here and
  // the API rejects it independently.
  const roleOptions = originalRole === 4 ? [1, 2, 3, 4] : [1, 2, 3]

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          aria-label={`编辑用户 ${user.name}`}
        >
          编辑
        </Button>
      </DialogTrigger>
      <DialogContent
        className="max-h-[90vh] overflow-y-auto sm:max-w-lg"
        showCloseButton={!busy}
        onEscapeKeyDown={(event) => {
          if (busy) {
            event.preventDefault()
          }
        }}
      >
        <DialogHeader>
          <DialogTitle>编辑用户</DialogTitle>
          <DialogDescription>
            仅修改密码、将状态设为「封禁」或降低角色会强制该用户重新登录；其余修改不会影响其登录状态。
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <label htmlFor={`${fieldId}-id`} className="text-sm font-medium">
              用户 ID
            </label>
            <Input
              id={`${fieldId}-id`}
              value={String(snapshotUid ?? user.id)}
              readOnly
              disabled
              aria-readonly="true"
            />
          </div>

          <div className="space-y-2">
            <label htmlFor={`${fieldId}-name`} className="text-sm font-medium">
              用户名
            </label>
            <Input
              id={`${fieldId}-name`}
              value={name}
              onChange={(event) => setName(event.target.value)}
              maxLength={17}
              required
              disabled={busy}
            />
          </div>

          <div className="space-y-2">
            <label htmlFor={`${fieldId}-email`} className="text-sm font-medium">
              邮箱
            </label>
            <Input
              id={`${fieldId}-email`}
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
              disabled={busy}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <label
                htmlFor={`${fieldId}-role`}
                className="text-sm font-medium"
              >
                角色
              </label>
              <Select
                value={String(role)}
                onValueChange={(value) => setRole(Number(value))}
                disabled={busy}
              >
                <SelectTrigger id={`${fieldId}-role`} className="w-full">
                  <SelectValue placeholder="选择角色" />
                </SelectTrigger>
                <SelectContent>
                  {roleOptions.map((value) => (
                    <SelectItem key={value} value={String(value)}>
                      {roleLabel(value)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {originalRole !== 4 ? (
                <p className="text-xs text-muted-foreground">
                  不能将用户提升为{roleLabel(4)}。
                </p>
              ) : null}
            </div>

            <div className="space-y-2">
              <label
                htmlFor={`${fieldId}-status`}
                className="text-sm font-medium"
              >
                状态
              </label>
              <Select
                value={String(status)}
                onValueChange={(value) => setStatus(Number(value))}
                disabled={busy}
              >
                <SelectTrigger id={`${fieldId}-status`} className="w-full">
                  <SelectValue placeholder="选择状态" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="0">正常</SelectItem>
                  <SelectItem value="1" disabled>
                    限制
                  </SelectItem>
                  <SelectItem value="2">封禁</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <label
              htmlFor={`${fieldId}-daily-image-count`}
              className="text-sm font-medium"
            >
              今日已用图片次数
            </label>
            <Input
              id={`${fieldId}-daily-image-count`}
              type="number"
              inputMode="numeric"
              min={0}
              max={50}
              step={1}
              value={dailyImageCount}
              onChange={(event) => setDailyImageCount(event.target.value)}
              required
              disabled={busy}
            />
            <p className="text-xs text-muted-foreground">
              该用户今日已消耗的图片次数（0~50 的整数），并非每日限额。
            </p>
          </div>

          <div className="space-y-2">
            <label
              htmlFor={`${fieldId}-password`}
              className="text-sm font-medium"
            >
              新密码
            </label>
            <Input
              id={`${fieldId}-password`}
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="留空则不修改密码"
              autoComplete="new-password"
              disabled={busy}
            />
            <p className="text-xs text-muted-foreground">
              6~1007 位，需同时包含字母和数字；修改密码会强制该用户重新登录。
            </p>
          </div>

          <div className="space-y-2">
            <label htmlFor={`${fieldId}-bio`} className="text-sm font-medium">
              简介
            </label>
            <Textarea
              id={`${fieldId}-bio`}
              value={bio}
              onChange={(event) => setBio(event.target.value)}
              rows={3}
              maxLength={107}
              placeholder="该用户的个人简介"
              disabled={busy}
            />
          </div>

          <Separator />

          <div className="flex items-center justify-between gap-4">
            <div className="space-y-1">
              <p className="flex items-center gap-2 text-sm font-medium">
                两步验证
                {enable2FA ? (
                  <Badge>已启用</Badge>
                ) : (
                  <Badge variant="secondary">未启用</Badge>
                )}
              </p>
              <p className="text-xs text-muted-foreground">
                关闭后该用户的两步验证设置将被清除，且其所有登录会话失效。
              </p>
            </div>
            <Button
              type="button"
              variant="destructive"
              size="sm"
              onClick={handleDisable2FA}
              disabled={!enable2FA || busy}
            >
              {busyAction === '2fa' ? (
                <Loader2 className="animate-spin" />
              ) : (
                <ShieldOff />
              )}
              关闭两步验证
            </Button>
          </div>

          {error ? (
            <div
              role="alert"
              className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive"
            >
              {error}
            </div>
          ) : null}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => handleOpenChange(false)}
              disabled={busy}
            >
              取消
            </Button>
            <Button type="submit" disabled={busy}>
              {busyAction === 'save' ? (
                <Loader2 className="animate-spin" />
              ) : null}
              {busyAction === 'save' ? '保存中…' : '保存'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
