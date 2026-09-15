'use client'

import { useState } from 'react'
import {
  Button,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  Radio,
  RadioGroup,
  Select,
  SelectItem,
  Textarea,
  Tooltip,
  useDisclosure
} from '@heroui/react'
import { MessageCircleQuestion } from 'lucide-react'
import toast from 'react-hot-toast'
import { kunFetchGet, kunFetchPost } from '~/utils/kunFetch'
import { useUserStore } from '~/store/userStore'
import { RESOURCE_SECTION_MAP } from '~/constants/resource'
import {
  CASE_CONTENT_MAX_LENGTH,
  CASE_DESCRIPTION_MIN_LENGTH
} from '~/constants/case'
import type { CaseCreateResponse } from '~/types/api/case'
import type { Patch, PatchResource } from '~/types/api/patch'

interface Props {
  patch: Patch
}

type FeedbackOption = 'patch_info' | 'resource_wrong_patch' | 'other'

export const FeedbackButton = ({ patch }: Props) => {
  const { user } = useUserStore((state) => state)
  const { isOpen, onOpen, onClose } = useDisclosure()
  const [option, setOption] = useState<FeedbackOption>('patch_info')
  const [content, setContent] = useState('')
  const [resources, setResources] = useState<PatchResource[] | null>(null)
  const [resourcesLoading, setResourcesLoading] = useState(false)
  const [resourcesError, setResourcesError] = useState('')
  const [selectedResourceId, setSelectedResourceId] = useState<number | null>(
    null
  )
  const [submitting, setSubmitting] = useState(false)

  // 条目资料有误：按真实权限引导到当前可用的修正入口，本批不生成事项。
  const patchInfoHint =
    user.role > 2
      ? '条目资料有误请直接使用条目页的「编辑游戏信息」修改，该选项不生成事项。'
      : '条目资料有误目前请在该条目的评论区说明具体错误位置，由有权限的用户协助修正，该选项不生成事项。'

  const fetchResources = async () => {
    setResourcesLoading(true)
    setResourcesError('')
    try {
      const res = await kunFetchGet<PatchResource[] | string>(
        '/patch/resource',
        { patchId: patch.id }
      )
      if (typeof res === 'string') {
        setResourcesError(res || '资源列表加载失败')
      } else {
        setResources(res)
      }
    } catch {
      setResourcesError('网络错误，资源列表加载失败')
    } finally {
      setResourcesLoading(false)
    }
  }

  const handleOptionChange = (value: string) => {
    const next = value as FeedbackOption
    setOption(next)
    if (
      next === 'resource_wrong_patch' &&
      resources === null &&
      !resourcesLoading
    ) {
      void fetchResources()
    }
  }

  const handleSubmit = async () => {
    if (user.uid < 1) {
      toast.error('请先登录后再提交')
      return
    }
    const trimmed = content.trim()
    if (trimmed.length < CASE_DESCRIPTION_MIN_LENGTH || submitting) return
    const payload =
      option === 'resource_wrong_patch'
        ? {
            kind: 'resource_wrong_patch',
            targetType: 'resource',
            targetId: selectedResourceId ?? 0,
            expectedPatchId: patch.id,
            content: trimmed
          }
        : {
            kind: 'other',
            targetType: 'patch',
            targetId: patch.id,
            content: trimmed
          }
    if (!payload.targetId) return

    setSubmitting(true)
    try {
      const res = await kunFetchPost<CaseCreateResponse | string>(
        '/case',
        payload
      )
      if (typeof res === 'string') {
        // 业务失败（目标已被移动等）保留输入
        toast.error(res || '提交失败，请稍后重试')
        return
      }
      if (res.justClosed) {
        toast('相同问题刚刚结案，请重新提交')
        return
      }
      toast.success(
        res.created
          ? '已提交，可在「问题处理」页跟进进度'
          : res.subscribed
            ? '相同问题已在处理中，已为你登记关注'
            : '已登记，正在处理'
      )
      setContent('')
      onClose()
    } catch {
      toast.error('网络错误，提交失败，请重试')
    } finally {
      setSubmitting(false)
    }
  }

  const needsContent = option !== 'patch_info'
  const submitDisabled =
    submitting ||
    !needsContent ||
    content.trim().length < CASE_DESCRIPTION_MIN_LENGTH ||
    (option === 'resource_wrong_patch' && !selectedResourceId)

  return (
    <>
      <Tooltip content="游戏反馈">
        <Button
          variant="bordered"
          isIconOnly
          aria-label="游戏反馈"
          onPress={onOpen}
          size="sm"
        >
          <MessageCircleQuestion className="size-4" />
        </Button>
      </Tooltip>

      <Modal isOpen={isOpen} onClose={onClose}>
        <ModalContent>
          <ModalHeader className="flex flex-col gap-1">
            提交 {patch.name} 的反馈
          </ModalHeader>
          <ModalBody>
            <RadioGroup
              aria-label="反馈类型"
              value={option}
              onValueChange={handleOptionChange}
            >
              <Radio value="patch_info">条目资料有误</Radio>
              <Radio value="resource_wrong_patch">资源发错条目</Radio>
              <Radio value="other">其他</Radio>
            </RadioGroup>

            {option === 'patch_info' && (
              <p className="text-sm text-default-500">{patchInfoHint}</p>
            )}

            {option === 'resource_wrong_patch' && (
              <div className="space-y-2">
                <p className="text-sm text-default-500">
                  选择发错条目的资源，该问题由站方处理，预计首次响应在 7 天内。
                </p>
                {resourcesError ? (
                  <div className="flex items-center gap-2">
                    <p role="alert" className="text-sm text-danger">
                      {resourcesError}
                    </p>
                    <Button
                      size="sm"
                      variant="bordered"
                      onPress={() => void fetchResources()}
                    >
                      重试
                    </Button>
                  </div>
                ) : (
                  <Select
                    aria-label="选择资源"
                    placeholder="请选择发错条目的资源"
                    isLoading={resourcesLoading}
                    selectedKeys={
                      selectedResourceId ? [String(selectedResourceId)] : []
                    }
                    onSelectionChange={(keys) => {
                      if (keys === 'all') return
                      const value = Array.from(keys)[0]
                      setSelectedResourceId(value ? Number(value) : null)
                    }}
                  >
                    {(resources ?? []).map((resource) => (
                      <SelectItem key={String(resource.id)}>
                        {`${resource.name}（${
                          RESOURCE_SECTION_MAP[resource.section] ??
                          resource.section
                        }）`}
                      </SelectItem>
                    ))}
                  </Select>
                )}
                {resources !== null && resources.length === 0 && (
                  <p className="text-sm text-default-400">该条目暂无可选资源</p>
                )}
              </div>
            )}

            {option === 'other' && (
              <p className="text-sm text-default-500">
                其他与该条目相关的问题，由站方处理，不承诺首次响应时限。
              </p>
            )}

            {needsContent && (
              <Textarea
                aria-label="问题描述"
                isRequired
                placeholder={`请填写问题描述（至少 ${CASE_DESCRIPTION_MIN_LENGTH} 个字符，纯文字）`}
                value={content}
                onValueChange={setContent}
                maxLength={CASE_CONTENT_MAX_LENGTH}
                isInvalid={
                  content.length > 0 &&
                  content.trim().length < CASE_DESCRIPTION_MIN_LENGTH
                }
                errorMessage={`问题描述最少 ${CASE_DESCRIPTION_MIN_LENGTH} 个字符`}
              />
            )}
          </ModalBody>
          <ModalFooter>
            <Button variant="light" onPress={onClose} isDisabled={submitting}>
              {needsContent ? '取消' : '关闭'}
            </Button>
            {needsContent && (
              <Button
                color="primary"
                onPress={() => void handleSubmit()}
                isDisabled={submitDisabled}
                isLoading={submitting}
              >
                提交
              </Button>
            )}
          </ModalFooter>
        </ModalContent>
      </Modal>
    </>
  )
}
