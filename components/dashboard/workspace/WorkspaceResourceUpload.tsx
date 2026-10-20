'use client'

import axios from 'axios'
import { useEffect, useRef, useState } from 'react'
import toast from 'react-hot-toast'
import { KunCaptchaCanvas } from '~/components/kun/auth/CaptchaCanvas'
import type { KunCaptchaImage } from '~/components/kun/auth/captcha'
import { Button } from '~/components/dashboard/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '~/components/dashboard/ui/dialog'
import { kunCaptchaErrorMessageMap } from '~/constants/captcha'
import type { KunUploadFileResponse } from '~/types/api/upload'
import { kunFetchGet, kunFetchPost } from '~/utils/kunFetch'
import { useWorkspaceUser } from './WorkspaceShell'

interface Props {
  disabled?: boolean
  /** Reports upload activity to the parent editor so it can guard save/delete. */
  onUploadingChange?: (active: boolean) => void
  onUploaded: (result: {
    storage: string
    uploadId: string
    hash: string
    size: string
  }) => void
}

/**
 * Same upload route, size gate, role gate and captcha as the site publisher.
 * The dialog is shadcn so the workspace does not pull in HeroUI.
 * Late responses after unmount or target change are ignored.
 */
export function WorkspaceResourceUpload({
  disabled,
  onUploadingChange,
  onUploaded
}: Props) {
  const role = useWorkspaceUser().role
  const [file, setFile] = useState<File | null>(null)
  const [progress, setProgress] = useState(0)
  const [uploading, setUploading] = useState(false)
  const [captchaOpen, setCaptchaOpen] = useState(false)
  const aliveRef = useRef(true)
  const uploadingRef = useRef(false)
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    aliveRef.current = true
    return () => {
      aliveRef.current = false
      uploadingRef.current = false
      onUploadingChange?.(false)
    }
    // Upload activity reporting is bound to this slot's lifetime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const upload = async (captcha: string, selected = file) => {
    if (!aliveRef.current) return
    if (!selected) {
      toast.error('未找到资源文件，请重试')
      return
    }
    uploadingRef.current = true
    setUploading(true)
    onUploadingChange?.(true)
    const formData = new FormData()
    formData.append('file', selected)
    formData.append('captcha', captcha)
    try {
      const response = await axios.post<KunUploadFileResponse | string>(
        '/api/upload/resource',
        formData,
        {
          headers: { 'X-Requested-With': 'kun-fetch' },
          onUploadProgress: (event) => {
            if (!aliveRef.current) return
            setProgress(
              Math.round(
                (event.loaded * 100) / (event.total || selected.size || 1)
              )
            )
          }
        }
      )
      if (!aliveRef.current) return
      if (typeof response.data === 'string') {
        toast.error(response.data || '上传失败，请重试')
        return
      }
      onUploaded({
        storage: response.data.filetype,
        uploadId: response.data.uploadId,
        hash: response.data.fileHash,
        size: response.data.fileSize
      })
      setFile(null)
      setProgress(0)
      toast.success('文件已上传')
    } catch {
      if (!aliveRef.current) return
      toast.error('上传失败，请稍后重试')
    } finally {
      uploadingRef.current = false
      if (aliveRef.current) {
        setUploading(false)
        onUploadingChange?.(false)
      }
    }
  }

  const closeCaptcha = () => {
    setCaptchaOpen(false)
    if (!uploadingRef.current) onUploadingChange?.(false)
  }

  const chooseFile = async (next: File | null) => {
    if (!next) return
    const sizeMb = next.size / (1024 * 1024)
    if (sizeMb > 100) {
      toast.error(`文件大小超出限制: ${sizeMb.toFixed(3)} MB，最大允许 100 MB`)
      return
    }
    if (role < 2) {
      toast.error('只有创作者和管理员可以上传文件到对象存储')
      return
    }
    setFile(next)
    setProgress(0)
    if (role < 3) {
      setCaptchaOpen(true)
      onUploadingChange?.(true)
    } else await upload('', next)
  }

  return (
    <div className="min-w-0 space-y-2">
      <input
        aria-label="上传资源文件"
        type="file"
        disabled={disabled || uploading}
        className="hidden"
        ref={(node) => {
          fileInputRef.current = node
        }}
        onChange={(event) => {
          const next = event.target.files?.[0] ?? null
          event.target.value = ''
          void chooseFile(next)
        }}
      />
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={disabled || uploading}
        onClick={() => fileInputRef.current?.click()}
      >
        上传到对象存储
      </Button>
      {uploading ? (
        <p className="text-sm text-muted-foreground">正在上传 {progress}%</p>
      ) : null}
      {file ? <p className="break-all text-sm">{file.name}</p> : null}
      {file && !uploading ? (
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => {
            if (role < 3) {
              setCaptchaOpen(true)
              onUploadingChange?.(true)
            } else void upload('', file)
          }}
        >
          重试上传
        </Button>
      ) : null}
      <CaptchaDialog
        open={captchaOpen}
        onOpenChange={(open) => {
          if (open) {
            setCaptchaOpen(true)
            onUploadingChange?.(true)
            return
          }
          closeCaptcha()
        }}
        isCurrent={() => aliveRef.current}
        onSuccess={async (code) => {
          if (!aliveRef.current) return
          setCaptchaOpen(false)
          await upload(code)
        }}
      />
    </div>
  )
}

function CaptchaDialog({
  open,
  onOpenChange,
  isCurrent,
  onSuccess
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  isCurrent: () => boolean
  onSuccess: (code: string) => Promise<void>
}) {
  const [images, setImages] = useState<KunCaptchaImage[]>([])
  const [sessionId, setSessionId] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(false)
  const [verifying, setVerifying] = useState(false)
  const [errorCount, setErrorCount] = useState(0)
  const attemptRef = useRef(0)

  const handleOpenChange = (next: boolean) => {
    if (!next) attemptRef.current += 1
    onOpenChange(next)
  }

  useEffect(() => {
    if (!open) return
    let cancelled = false
    setLoading(true)
    setSelected(new Set())
    void kunFetchGet<{ images: KunCaptchaImage[]; sessionId: string }>(
      '/auth/captcha'
    )
      .then((response) => {
        if (cancelled || typeof response === 'string') return
        setImages(response.images)
        setSessionId(response.sessionId)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [open, errorCount])

  const verify = async () => {
    if (verifying) return
    const attempt = attemptRef.current
    setVerifying(true)
    try {
      const response = await kunFetchPost<{ code: string } | string>(
        '/auth/captcha',
        { sessionId, selectedIds: Array.from(selected) }
      )
      if (attempt !== attemptRef.current || !isCurrent()) return
      if (typeof response === 'string') {
        toast.error(
          kunCaptchaErrorMessageMap[Math.min(errorCount + 1, 6)] ?? response
        )
        setErrorCount((current) => current + 1)
        return
      }
      await onSuccess(response.code)
    } finally {
      if (isCurrent()) setVerifying(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>人机验证</DialogTitle>
        </DialogHeader>
        <p className="text-sm">请选择下面所有的白毛男孩子</p>
        {loading ? (
          <p className="text-sm">正在加载验证…</p>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            {images.map((image) => (
              <KunCaptchaCanvas
                key={image.id}
                image={image}
                isSelected={selected.has(image.id)}
                onSelect={() => {
                  setSelected((current) => {
                    const next = new Set(current)
                    if (next.has(image.id)) next.delete(image.id)
                    else next.add(image.id)
                    return next
                  })
                }}
              />
            ))}
          </div>
        )}
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => handleOpenChange(false)}
          >
            取消
          </Button>
          <Button
            type="button"
            disabled={selected.size === 0 || verifying}
            onClick={() => void verify()}
          >
            确定
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
