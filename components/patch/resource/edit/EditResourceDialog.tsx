'use client'

import { z } from 'zod'
import { Button } from '@heroui/button'
import {
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader
} from '@heroui/react'
import { useEffect, useRef, useState } from 'react'
import { useForm } from 'react-hook-form'
import type { Resolver } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import toast from 'react-hot-toast'
import { kunFetchPut } from '~/utils/kunFetch'
import { patchResourceStableEditFormSchema } from '~/validations/patch'
import { ResourceLinksInput } from '../publish/ResourceLinksInput'
import { ResourceDetailsForm } from '../publish/ResourceDetailsForm'
import { ResourceSectionSelect } from '../publish/ResourceSectionSelect'
import { readEditContext } from '../accessResourceLinksForEdit'
import type { ResourceEditContext } from '../accessResourceLinksForEdit'
import { isLinkConflictError } from '../linkHealthDisplay'
import type { ControlType } from '../share'
import type {
  PatchResource,
  PatchResourceStableUpdateResponse
} from '~/types/api/patch'
import {
  normalizeLegacyResourceTypes,
  type ResourceSection
} from '~/constants/resource'

type EditResourceFormData = z.infer<typeof patchResourceStableEditFormSchema>

interface EditResourceDialogProps {
  resource: PatchResource
  onClose: () => void
  onSuccess: (resource: PatchResourceStableUpdateResponse) => void
  type?: 'patch' | 'admin'
}

/**
 * 稳定槽位编辑器（M04-1）：基点在打开时一次性捕获（站点水合快照或后台已
 * 授权 DTO），无基点或基点不一致一律失败关闭、只给刷新指引，绝不退回旧
 * 写入形状。表单以打开快照初始化；后台父级刷新传进新对象时不重置脏草稿，
 * 只有换成另一条资源（id 变化）才重建表单。具名 409 与网络错误都保留草稿。
 */
export const EditResourceDialog = ({
  resource,
  onClose,
  onSuccess,
  type = 'patch'
}: EditResourceDialogProps) => {
  const [editing, setEditing] = useState(false)
  const [uploadingResource, setUploadingResource] = useState(false)
  const [submitError, setSubmitError] = useState('')

  const section = resource.section as ResourceSection
  // 编辑会话：每次打开为一个资源捕获一次不可变基点。同一资源的后续父级
  // 刷新（含服务端已推进到更新基点的对象）绝不改当前会话的基点或草稿；
  // 只有换成另一条资源才结束当前会话并重新捕获（无上下文即失败关闭）。
  const [session, setSession] = useState<{
    id: number
    context: ResourceEditContext | null
  }>(() => ({ id: resource.id, context: readEditContext(resource) }))
  const prevResourceRef = useRef(resource)
  useEffect(() => {
    // 以对象引用为触发面：同一对象的重复渲染不算刷新；同目标已有合法基点
    // 的会话保持不变（草稿与旧基点不被刷新吞掉）；会话尚无基点时允许从
    // 新到达的对象补捕获；换目标结束当前会话重新捕获（无上下文失败关闭）。
    if (prevResourceRef.current === resource) return
    prevResourceRef.current = resource
    setSession((current) => {
      if (current.id === resource.id && current.context) {
        return current
      }
      const nextContext = readEditContext(resource)
      if (current.id === resource.id) {
        return nextContext ? { id: resource.id, context: nextContext } : current
      }
      return { id: resource.id, context: nextContext }
    })
  }, [resource])
  const editContext: ResourceEditContext | null =
    session.id === resource.id ? session.context : null
  const baseLinks = editContext?.baseLinks ?? []
  const focusLinkId = editContext?.focusLinkId

  const {
    control,
    reset,
    setValue,
    watch,
    handleSubmit,
    formState: { errors }
  } = useForm<EditResourceFormData>({
    resolver: zodResolver(
      patchResourceStableEditFormSchema
    ) as unknown as Resolver<EditResourceFormData>,
    defaultValues: {
      ...resource,
      baseLinks,
      section,
      type: normalizeLegacyResourceTypes(resource.type)
    }
  })

  // 表单重建只对「真实会话边界」发生：换了另一条资源，或当前会话首次拿到
  // 合法基点（含失败后补捕获）。会话已定基点后同目标的任何刷新不重置。
  const sessionResetKey = `${session.id}:${
    editContext
      ? editContext.baseLinks
          .map((base) => `${base.id}:${base.version}`)
          .join(',')
      : 'none'
  }`
  const openResetKeyRef = useRef(sessionResetKey)
  useEffect(() => {
    if (sessionResetKey === openResetKeyRef.current) {
      return
    }
    openResetKeyRef.current = sessionResetKey
    if (editContext) {
      reset({
        ...resource,
        baseLinks: editContext.baseLinks,
        section,
        type: normalizeLegacyResourceTypes(resource.type)
      })
      setSubmitError('')
    }
  }, [sessionResetKey, editContext, resource, reset, section])

  const handleUpdateResource = async (data: EditResourceFormData) => {
    setEditing(true)
    setSubmitError('')
    try {
      const res = await kunFetchPut<
        KunResponse<PatchResourceStableUpdateResponse> | string
      >(`/${type}/resource`, { resourceId: resource.id, ...data })

      if (typeof res === 'string') {
        // 具名 409 与其他业务错误都保留草稿；冲突在弹内持久提示。
        if (isLinkConflictError(res)) {
          setSubmitError(res)
        }
        toast.error(res)
        return
      }

      // 成功结果以服务端实际返回的资源/版本/健康为准；补链后的自动检测
      // 失败或过期仅提醒，不回滚已提交的保存。
      if (res.linkChecks?.some((check) => check.outcome !== 'observed')) {
        toast(
          '保存成功；部分链接的自动检测未完成或结果已过期，状态将稍后更新。'
        )
      }
      onSuccess(res)
      toast.success('资源更新成功')
    } catch {
      // 网络失败同样保留草稿并释放 loading
      setSubmitError('网络错误，保存失败，请重试')
      toast.error('网络错误，保存失败，请重试')
    } finally {
      setEditing(false)
    }
  }

  if (!editContext) {
    return (
      <ModalContent>
        <ModalHeader className="flex-col space-y-2">
          <h3 className="text-lg">更改资源链接</h3>
        </ModalHeader>
        <ModalBody>
          <p role="alert" className="text-sm text-danger">
            链接编辑基点缺失或已过期，本次不能保存。请关闭本窗口、刷新数据后重新打开编辑。
          </p>
        </ModalBody>
        <ModalFooter>
          <Button color="danger" variant="light" onPress={onClose}>
            关闭
          </Button>
        </ModalFooter>
      </ModalContent>
    )
  }

  return (
    <ModalContent>
      <ModalHeader className="flex-col space-y-2">
        <h3 className="text-lg">更改资源链接</h3>
        <p className="select-none text-sm font-medium text-default-500">
          若您想要更改您的对象存储链接, 您现在可以直接上传新文件,
          系统会自动更新云端文件, 无需删除后重新发布
        </p>
      </ModalHeader>

      <ModalBody>
        {submitError && (
          <p role="alert" className="text-sm text-danger">
            {submitError}（您的修改已保留，请关闭后重新打开编辑再试）
          </p>
        )}
        <form className="space-y-6">
          <ResourceSectionSelect
            errors={errors}
            section={watch().section}
            setSection={(content) => setValue('section', content)}
          />

          {/*
            稳定表单含必填 baseLinks，共享 Fields 里是可选；控制对象在共享
            表单组件只看 links/section 字段，做一次显式收窄。
          */}
          <ResourceLinksInput
            control={control as unknown as ControlType}
            errors={errors}
            setValue={setValue}
            watch={watch}
            section={watch().section}
            setUploadingResource={setUploadingResource}
            focusLinkId={focusLinkId}
          />
          <ResourceDetailsForm
            control={control as unknown as ControlType}
            setValue={(name, value) => setValue(name, value)}
            errors={errors}
            section={watch().section as ResourceSection}
          />
        </form>
      </ModalBody>

      <ModalFooter>
        <Button color="danger" variant="light" onPress={onClose}>
          取消
        </Button>
        <Button
          color="primary"
          disabled={editing || uploadingResource}
          isLoading={editing || uploadingResource}
          onPress={() => {
            void handleSubmit(handleUpdateResource)()
          }}
        >
          {editing
            ? '更新中...'
            : uploadingResource
              ? '正在上传补丁资源中...'
              : '保存'}
        </Button>
      </ModalFooter>
    </ModalContent>
  )
}
