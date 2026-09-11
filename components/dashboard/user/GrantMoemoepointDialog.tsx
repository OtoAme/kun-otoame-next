'use client'

import { useEffect, useId, useRef, useState } from 'react'
import toast from 'react-hot-toast'
import { Coins, ExternalLink, Loader2 } from 'lucide-react'
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
import { Textarea } from '~/components/dashboard/ui/textarea'
import { kunFetchPost } from '~/utils/kunFetch'
import { generateUUID } from '~/utils/random'
import { useUserStore } from '~/store/userStore'
import type { MoemoepointBalance } from '~/types/api/moemoepoint'

interface GrantTargetUser {
  id: number
  name: string
}

interface GrantMoemoepointDialogProps {
  user: GrantTargetUser
  currentUserId: number
  onGranted?: (uid: number) => void
}

interface GrantResult {
  balance: MoemoepointBalance
  applied: boolean
}

/**
 * 结果未知时被冻结的请求快照。
 * 重试必须原样重发: 换一个 requestId 或改任何一个参数都会变成第二笔发放。
 * 仅保存在组件内存中, 不写入任何外部存储。
 */
interface PendingGrantRequest {
  uid: number
  requestId: string
  amount: number
  reason?: string
}

export const GrantMoemoepointDialog = ({
  user,
  currentUserId,
  onGranted
}: GrantMoemoepointDialogProps) => {
  const [open, setOpen] = useState(false)
  const [amount, setAmount] = useState('')
  const [reason, setReason] = useState('')
  const [requestId, setRequestId] = useState('')
  const [pendingRequest, setPendingRequest] =
    useState<PendingGrantRequest | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  // 同步锁: setState 是异步的, await 之前必须先用 ref 落锁, 防止连击产生第二笔发放
  const inflightRef = useRef(false)
  const mountedRef = useRef(true)
  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  // 目标用户切换 (例如同组件内跳转到其他用户账单页) 时:
  // 关闭弹窗并丢弃旧目标的草稿与冻结快照, 避免 A 的表单/快照套用到 B。
  // 目标不变的重渲染保留未保存的草稿; 在途旧目标响应由 targetIdRef 守卫丢弃。
  const targetIdRef = useRef(user.id)
  useEffect(() => {
    if (targetIdRef.current === user.id) {
      return
    }
    targetIdRef.current = user.id
    setPendingRequest(null)
    setAmount('')
    setReason('')
    setError(null)
    setRequestId(generateUUID())
    setOpen(false)
  }, [user.id])

  const fieldId = useId()
  const amountId = `${fieldId}-amount`
  const reasonId = `${fieldId}-reason`

  const frozen = pendingRequest !== null

  const handleOpenChange = (nextOpen: boolean) => {
    // 请求在途时锁定关闭 (含右上角 X / Escape / 遮罩点击 / 取消按钮)
    if (inflightRef.current) {
      return
    }
    if (nextOpen) {
      // 每次打开都生成全新的请求标识并清空表单与冻结快照
      setRequestId(generateUUID())
      setAmount('')
      setReason('')
      setPendingRequest(null)
      setError(null)
      setOpen(true)
    } else {
      setOpen(false)
    }
  }

  const handleGrant = async () => {
    if (inflightRef.current) {
      return
    }

    let request: PendingGrantRequest
    if (pendingRequest) {
      // 结果未知的请求必须原样重发: 不换新 requestId, 不改任何参数
      request = pendingRequest
    } else {
      const trimmedAmount = amount.trim()
      const numAmount = Number(trimmedAmount)
      if (
        !trimmedAmount ||
        !Number.isInteger(numAmount) ||
        numAmount < 1 ||
        numAmount > 100000
      ) {
        setError('请输入 1 到 100000 之间的整数数量')
        return
      }
      const trimmedReason = reason.trim()
      if (trimmedReason.length > 500) {
        setError('发放理由不能超过 500 字')
        return
      }
      request = {
        uid: user.id,
        requestId,
        amount: numAmount,
        ...(trimmedReason ? { reason: trimmedReason } : {})
      }
    }

    inflightRef.current = true
    setBusy(true)
    setError(null)

    const body: Record<string, unknown> = {
      uid: request.uid,
      amount: request.amount,
      requestId: request.requestId
    }
    if (request.reason) {
      body.reason = request.reason
    }

    let result: GrantResult | null = null
    let businessError: string | null = null
    let unknownFailure = false
    try {
      const res = await kunFetchPost<GrantResult | string>('/admin/user', body)
      if (typeof res === 'string') {
        // kunFetch 约定: 任何字符串 (包括空串) 都是业务错误
        businessError = res
      } else if (res && typeof res === 'object') {
        result = res
      } else {
        // 200 但无有效负载属于结果不明, 按未知结果处理以避免任何重复发放风险
        unknownFailure = true
      }
    } catch {
      // 网络异常: 发放结果未知, 冻结快照等待人工核对或原样重试
      unknownFailure = true
    } finally {
      inflightRef.current = false
      if (mountedRef.current) {
        setBusy(false)
      }
    }

    if (businessError !== null) {
      // 业务错误是确定性响应: 保留表单与错误信息, 冻结快照保持不变。
      // 目标已切换时静默丢弃旧目标的响应, 不在新目标弹窗上落状态。
      if (mountedRef.current && targetIdRef.current === request.uid) {
        setError(businessError.trim() || '发放失败, 请稍后重试')
      }
      return
    }

    if (unknownFailure || !result) {
      toast.error('网络异常, 本次发放结果未知, 请先核对账单或重试原请求')
      if (mountedRef.current && targetIdRef.current === request.uid) {
        setPendingRequest(request)
        setError(
          '网络异常, 本次发放结果未知。请点击「重试原请求」重试 (不会重复到账), 或关闭弹窗后先核对账单再重新发起。'
        )
      }
      return
    }

    // 仅当发放目标就是操作者本人时才更新自己的余额;
    // 以 getState() 实时身份二次校验, 绝不在查看他人时覆盖操作者余额
    if (
      request.uid === currentUserId &&
      useUserStore.getState().user.uid === currentUserId
    ) {
      useUserStore.getState().setMoemoepointBalance(result.balance)
    }

    toast.success(
      result.applied
        ? `成功为 ${user.name} 发放 ${request.amount} 萌萌点`
        : '该请求此前已生效, 未重复发放'
    )

    // 先清理并关闭成功界面, 再触发调用方回调:
    // 即使回调抛错, 已成功的弹窗也已关闭, 不会残留可重复提交的表单。
    // 回调在 catch 之外执行并使用捕获的目标 uid, 回调异常不会被误判为发放失败。
    // 守卫用 targetIdRef 而非闭包里的 user.id, 目标切换后旧响应不会操作新弹窗。
    if (mountedRef.current && targetIdRef.current === request.uid) {
      setPendingRequest(null)
      setAmount('')
      setReason('')
      setError(null)
      setOpen(false)
    }
    onGranted?.(request.uid)
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          aria-label={`为 ${user.name} (UID: ${user.id}) 发放萌萌点`}
        >
          <Coins className="h-4 w-4" />
          发放萌萌点
        </Button>
      </DialogTrigger>
      <DialogContent
        className="max-h-[90vh] overflow-y-auto"
        onEscapeKeyDown={(event) => {
          if (inflightRef.current) {
            event.preventDefault()
          }
        }}
        onInteractOutside={(event) => {
          if (inflightRef.current) {
            event.preventDefault()
          }
        }}
      >
        <DialogHeader>
          <DialogTitle>发放萌萌点</DialogTitle>
          <DialogDescription>
            向 {user.name} (UID: {user.id}) 发放萌萌点,
            确认后立即到账并写入账单。
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <label htmlFor={amountId} className="text-sm font-medium">
              数量 (1-100000 的整数)
            </label>
            <Input
              id={amountId}
              type="number"
              min={1}
              max={100000}
              step={1}
              inputMode="numeric"
              placeholder="请输入发放数量"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              disabled={busy || frozen}
              required
            />
          </div>
          <div className="space-y-2">
            <label htmlFor={reasonId} className="text-sm font-medium">
              理由 (可选, 不超过 500 字)
            </label>
            <Textarea
              id={reasonId}
              placeholder="请输入发放理由"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              disabled={busy || frozen}
              maxLength={500}
              rows={3}
            />
          </div>

          {frozen && pendingRequest && (
            <div className="rounded-md border border-amber-500/50 bg-amber-500/10 px-3 py-2 text-sm">
              <p>
                上次请求 {pendingRequest.amount} 萌萌点
                {pendingRequest.reason
                  ? ` (理由「${pendingRequest.reason}」)`
                  : ''}{' '}
                结果未知: 点击「重试原请求」重试不会重复到账; 如需关闭, 请先
                <a
                  href={`/dashboard/user/${pendingRequest.uid}/moemoepoint`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 px-1 text-primary underline underline-offset-4"
                >
                  在新标签页核对 {user.name} 的萌萌点账单
                  <ExternalLink className="h-3 w-3" />
                </a>
                , 确认未到账后再重新发起。
              </p>
            </div>
          )}

          {error && (
            <div
              role="alert"
              className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive"
            >
              {error}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => handleOpenChange(false)}
            disabled={busy}
          >
            {frozen ? '关闭' : '取消'}
          </Button>
          <Button
            type="button"
            onClick={handleGrant}
            disabled={busy || (!frozen && !amount.trim())}
          >
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}
            {busy ? '提交中…' : frozen ? '重试原请求' : '确认发放'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
