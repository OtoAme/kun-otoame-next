'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import { Button, Modal, useDisclosure } from '@heroui/react'
import { kunFetchGet } from '~/utils/kunFetch'
import { KunLoading } from '~/components/kun/Loading'
import { EditResourceDialog } from '~/components/patch/resource/edit/EditResourceDialog'
import {
  captureResourceEditContext,
  withEditContext
} from '~/components/patch/resource/accessResourceLinksForEdit'
import type { AdminResource } from '~/types/api/admin'
import type {
  PatchResource,
  PatchResourceStableUpdateResponse
} from '~/types/api/patch'

const PG_INT_MAX = 2147483647

const parsePositiveId = (raw: string | null): number | null => {
  if (!raw || !/^[1-9]\d*$/.test(raw)) return null
  const value = Number(raw)
  return Number.isSafeInteger(value) && value <= PG_INT_MAX ? value : null
}

interface ListResponse {
  resources: AdminResource[]
  total: number
}

type LoadState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; resource: PatchResource }

const inboxHref = (linkId: number | null) =>
  `/dashboard/inbox${
    linkId !== null ? `?kinds=broken-link&kind=broken-link&id=${linkId}` : ''
  }`

/**
 * 失效链接待办的唯一受权编辑路径（role>=3，含隐藏资源）：用既有的
 * `GET /admin/resource` 精确读取一条 DTO（自带 baseLinks 与全部凭据），
 * 打开既有 HeroUI 资源编辑（整表单、稳定基点）。绝不为编辑走下载获取通道，
 * 不新增写端点，不出现整条资源 DELETE。保存或取消都回到收件箱原位。
 */
export const ResourceLinkEditClient = () => {
  const router = useRouter()
  const params = useParams<{ id: string }>()
  const searchParams = useSearchParams()

  const resourceId = parsePositiveId(params?.id ?? null)
  const focusLinkId = parsePositiveId(searchParams.get('linkId'))

  const [state, setState] = useState<LoadState>({ status: 'loading' })
  const [editable, setEditable] = useState<PatchResource | null>(null)
  const mountedRef = useRef(true)
  const generationRef = useRef(0)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      generationRef.current += 1
    }
  }, [])

  const load = useCallback(async () => {
    const generation = ++generationRef.current
    setState({ status: 'loading' })
    setEditable(null)
    if (resourceId === null) {
      setState({
        status: 'error',
        message: '链接参数不正确，请从收件箱重新打开。'
      })
      return
    }
    try {
      const res = await kunFetchGet<ListResponse | string>('/admin/resource', {
        page: 1,
        limit: 1,
        resourceId
      })
      if (!mountedRef.current || generation !== generationRef.current) return
      if (typeof res === 'string') {
        setState({ status: 'error', message: res || '加载失败，请稍后重试' })
        return
      }
      const resource = res.resources[0]
      if (!resource || resource.id !== resourceId || res.total < 1) {
        setState({
          status: 'error',
          message: '该资源不存在或当前不可访问，请返回收件箱查看最新状态。'
        })
        return
      }
      const context = captureResourceEditContext(resource)
      if (!context) {
        setState({
          status: 'error',
          message: '链接编辑基点缺失，请稍后重试；如仍失败请联系站点管理员。'
        })
        return
      }
      const focus =
        focusLinkId !== null &&
        resource.links.some((link) => link.id === focusLinkId)
          ? focusLinkId
          : undefined
      const prepared = withEditContext(resource, {
        ...context,
        ...(focus !== undefined ? { focusLinkId: focus } : {})
      })
      setEditable(prepared)
      setState({ status: 'ready', resource: prepared })
    } catch {
      if (!mountedRef.current || generation !== generationRef.current) return
      setState({ status: 'error', message: '网络错误，加载失败，请重试' })
    }
  }, [resourceId, focusLinkId])

  useEffect(() => {
    void load()
  }, [load])

  const disclosure = useDisclosure({ defaultOpen: true })
  const back = () => router.push(inboxHref(focusLinkId))
  const handleSaved = (_resource: PatchResourceStableUpdateResponse) => back()
  const handleClose = () => {
    disclosure.onClose()
    back()
  }

  if (state.status === 'loading') {
    return <KunLoading hint="正在加载资源编辑..." />
  }
  if (state.status === 'error') {
    return (
      <div className="flex flex-col items-start gap-3 py-8">
        <p role="alert" className="text-sm text-default-600">
          {state.message}
        </p>
        <div className="flex gap-2">
          <Button size="sm" variant="flat" onPress={() => void load()}>
            重试
          </Button>
          <Button size="sm" variant="light" onPress={back}>
            返回收件箱
          </Button>
        </div>
      </div>
    )
  }

  return (
    <Modal
      size="3xl"
      isOpen={disclosure.isOpen}
      onClose={handleClose}
      scrollBehavior="outside"
      isDismissable={false}
      isKeyboardDismissDisabled={true}
    >
      {disclosure.isOpen && editable && (
        <EditResourceDialog
          resource={editable}
          onClose={handleClose}
          onSuccess={handleSaved}
          type="admin"
        />
      )}
    </Modal>
  )
}
