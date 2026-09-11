'use client'

import { useEffect, useRef, useState } from 'react'
import toast from 'react-hot-toast'
import { Loader2, Trash2 } from 'lucide-react'
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger
} from '~/components/dashboard/ui/alert-dialog'
import { Button } from '~/components/dashboard/ui/button'
import { kunFetchDelete } from '~/utils/kunFetch'

interface DeleteTargetUser {
  id: number
  name: string
}

interface DeleteUserDialogProps {
  user: DeleteTargetUser
  currentUserId: number
  onDeleted: (uid: number) => void
}

export const DeleteUserDialog = ({
  user,
  currentUserId,
  onDeleted
}: DeleteUserDialogProps) => {
  const [open, setOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  // 同步锁: await 之前先落 ref 锁, 防止连击重复提交
  const inflightRef = useRef(false)
  const mountedRef = useRef(true)
  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  // 目标用户切换时关闭弹窗并清除错误, 防止对错误目标确认删除。
  // 在途的旧目标响应随后会被 targetIdRef 守卫丢弃, 不会落到新目标弹窗上。
  const targetIdRef = useRef(user.id)
  useEffect(() => {
    if (targetIdRef.current === user.id) {
      return
    }
    targetIdRef.current = user.id
    setError(null)
    setOpen(false)
  }, [user.id])

  const isSelf = user.id === currentUserId

  const handleOpenChange = (nextOpen: boolean) => {
    // 删除在途时锁定关闭 (含 X / Escape / 遮罩 / 取消)
    if (inflightRef.current) {
      return
    }
    setOpen(nextOpen)
    if (!nextOpen) {
      setError(null)
    }
  }

  const handleDelete = async () => {
    if (inflightRef.current) {
      return
    }
    if (isSelf) {
      setError('请勿删除自己')
      return
    }

    // 捕获目标身份, 后续回调与提示均使用快照, 不依赖可能变化的 props
    const targetId = user.id
    const targetName = user.name

    inflightRef.current = true
    setBusy(true)
    setError(null)

    let businessError: string | null = null
    let unknownFailure = false
    let succeeded = false
    try {
      // uid 走查询字符串, 不使用请求体, 不新增端点
      const res = await kunFetchDelete<Record<string, unknown> | string>(
        '/admin/user',
        { uid: targetId }
      )
      if (typeof res === 'string') {
        // kunFetch 约定: 任何字符串 (包括空串) 都是业务错误
        businessError = res
      } else {
        succeeded = true
      }
    } catch {
      unknownFailure = true
    } finally {
      inflightRef.current = false
      if (mountedRef.current) {
        setBusy(false)
      }
    }

    if (succeeded) {
      toast.success(`已永久删除用户 ${targetName} (UID: ${targetId})`)
      if (mountedRef.current && targetIdRef.current === targetId) {
        setOpen(false)
        setError(null)
      }
      // 回调放在 catch 之外, 使用捕获的目标 uid
      onDeleted(targetId)
      return
    }

    if (businessError !== null) {
      // 业务错误: 保留弹窗与可见错误, 不关闭; 目标已切换时丢弃旧响应
      if (mountedRef.current && targetIdRef.current === targetId) {
        setError(businessError.trim() || '删除失败, 请稍后重试')
      }
      return
    }

    if (unknownFailure) {
      toast.error('网络异常, 删除结果未知, 请刷新列表后核对')
      if (mountedRef.current && targetIdRef.current === targetId) {
        setError(
          '网络异常, 删除结果未知。请刷新用户列表确认该用户是否仍存在, 再决定是否重试。'
        )
      }
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={handleOpenChange}>
      <AlertDialogTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={isSelf}
          title={isSelf ? '不能删除自己' : undefined}
          aria-label={`删除用户 ${user.name} (UID: ${user.id})`}
          className="cursor-pointer disabled:cursor-default"
        >
          <Trash2 className="h-4 w-4" />
          删除用户
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent
        onEscapeKeyDown={(event) => {
          if (inflightRef.current) {
            event.preventDefault()
          }
        }}
      >
        <AlertDialogHeader>
          <AlertDialogTitle>永久删除用户</AlertDialogTitle>
          <AlertDialogDescription>
            即将永久删除用户 {user.name} (UID: {user.id}
            )。其账号及全部关联数据将被删除, 且不可恢复。请确认无误后再执行。
          </AlertDialogDescription>
        </AlertDialogHeader>

        {error && (
          <div
            role="alert"
            className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive"
          >
            {error}
          </div>
        )}

        <AlertDialogFooter>
          <AlertDialogCancel
            disabled={busy}
            className="cursor-pointer disabled:cursor-default"
          >
            取消
          </AlertDialogCancel>
          <Button
            type="button"
            variant="destructive"
            onClick={handleDelete}
            disabled={busy}
            className="cursor-pointer disabled:cursor-default"
          >
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}
            {busy ? '删除中…' : '永久删除用户'}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
