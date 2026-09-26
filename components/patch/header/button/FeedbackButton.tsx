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
import { CaseImageField } from '~/components/case/CaseImageField'
import { CaseLoginPrompt } from '~/components/case/CaseLoginPrompt'
import { CaseSubmitResult } from '~/components/case/CaseSubmitResult'
import { useCaseImageUploads } from '~/components/case/useCaseImageUploads'
import type { CaseCreateResponse } from '~/types/api/case'
import type { Patch, PatchResource } from '~/types/api/patch'

interface Props {
  patch: Patch
}

type FeedbackOption = 'patch_info' | 'resource_wrong_patch' | 'other'

// 处理方与预计首次响应沿用基线 8.6 的受理范围口径
const OPTION_HINTS: Record<FeedbackOption, string> = {
  patch_info: '由网站管理员核对后修改，预计首次响应在 7 天内。',
  resource_wrong_patch:
    '选择发错条目的资源，由网站管理员处理，预计首次响应在 7 天内。',
  other: '其他与该游戏相关的问题，由网站管理员处理，不承诺首次响应时限。'
}

const OPTION_HANDLERS: Record<FeedbackOption, string> = {
  patch_info: '网站管理员，预计 7 天内首次回应',
  resource_wrong_patch: '网站管理员，预计 7 天内首次回应',
  other: '网站管理员'
}

const OPTION_PLACEHOLDERS: Record<FeedbackOption, string> = {
  patch_info:
    '哪一项资料有误（如发售日期、会社、简介），正确内容是……，来源是……',
  resource_wrong_patch: '这条资源实际属于哪个游戏……',
  other: '请描述遇到的问题'
}

export const FeedbackButton = ({ patch }: Props) => {
  const { user } = useUserStore((state) => state)
  const { isOpen, onOpen, onClose } = useDisclosure()
  const login = useDisclosure()
  const uploads = useCaseImageUploads()
  const [option, setOption] = useState<FeedbackOption>('patch_info')
  const [content, setContent] = useState('')
  const [resources, setResources] = useState<PatchResource[] | null>(null)
  const [resourcesLoading, setResourcesLoading] = useState(false)
  const [resourcesError, setResourcesError] = useState('')
  const [selectedResourceId, setSelectedResourceId] = useState<number | null>(
    null
  )
  const [submitting, setSubmitting] = useState(false)
  const [result, setResult] = useState<CaseCreateResponse | null>(null)

  // 反馈需要登录，打开时就提示，不让访客写完才发现（D22）
  const handleOpen = () => (user.uid < 1 ? login.onOpen() : onOpen())

  const handleClose = () => {
    if (submitting) return
    if (result) {
      setResult(null)
      setOption('patch_info')
      setContent('')
      setSelectedResourceId(null)
      uploads.reset()
    }
    onClose()
  }

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

  const tooShort = content.trim().length < CASE_DESCRIPTION_MIN_LENGTH

  const handleSubmit = async () => {
    if (tooShort || submitting || uploads.uploading) return
    const trimmed = content.trim()
    const payload =
      option === 'resource_wrong_patch'
        ? {
            kind: 'resource_wrong_patch',
            targetType: 'resource',
            targetId: selectedResourceId ?? 0,
            expectedPatchId: patch.id,
            content: trimmed,
            imageKeys: uploads.keys
          }
        : {
            kind: option,
            targetType: 'patch',
            targetId: patch.id,
            content: trimmed,
            imageKeys: uploads.keys
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
      setResult(res)
    } catch {
      toast.error('网络错误，提交失败，请重试')
    } finally {
      setSubmitting(false)
    }
  }

  const submitDisabled =
    submitting ||
    uploads.uploading ||
    tooShort ||
    (option === 'resource_wrong_patch' && !selectedResourceId)

  return (
    <>
      <Tooltip content="游戏反馈">
        <Button
          variant="bordered"
          isIconOnly
          aria-label="游戏反馈"
          onPress={handleOpen}
          size="sm"
        >
          <MessageCircleQuestion className="size-4" />
        </Button>
      </Tooltip>

      <Modal isOpen={isOpen} onClose={handleClose} scrollBehavior="inside">
        <ModalContent>
          <ModalHeader className="flex flex-col gap-1">
            提交 {patch.name} 的反馈
          </ModalHeader>
          <ModalBody>
            {result ? (
              <CaseSubmitResult
                result={result}
                handler={OPTION_HANDLERS[option]}
              />
            ) : (
              <>
                <RadioGroup
                  aria-label="反馈类型"
                  value={option}
                  onValueChange={handleOptionChange}
                >
                  <Radio value="patch_info">条目资料有误</Radio>
                  <Radio value="resource_wrong_patch">资源发错条目</Radio>
                  <Radio value="other">其他</Radio>
                </RadioGroup>

                <p className="text-sm text-default-500">
                  {OPTION_HINTS[option]}
                  {option === 'patch_info' && user.role > 2
                    ? '你也可以直接用「编辑游戏信息」修改。'
                    : ''}
                </p>

                {option === 'resource_wrong_patch' && (
                  <div className="space-y-2">
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
                      <p className="text-sm text-default-400">
                        该条目暂无可选资源
                      </p>
                    )}
                  </div>
                )}

                <Textarea
                  aria-label="问题描述"
                  isRequired
                  placeholder={OPTION_PLACEHOLDERS[option]}
                  description={`至少 ${CASE_DESCRIPTION_MIN_LENGTH} 个字符，纯文字；可以附截图`}
                  value={content}
                  onValueChange={setContent}
                  maxLength={CASE_CONTENT_MAX_LENGTH}
                  isInvalid={content.length > 0 && tooShort}
                  errorMessage={`问题描述最少 ${CASE_DESCRIPTION_MIN_LENGTH} 个字符`}
                />
                <CaseImageField uploads={uploads} isDisabled={submitting} />
              </>
            )}
          </ModalBody>
          <ModalFooter>
            {result ? (
              <Button variant="light" onPress={handleClose}>
                关闭
              </Button>
            ) : (
              <>
                <Button
                  variant="light"
                  onPress={handleClose}
                  isDisabled={submitting}
                >
                  取消
                </Button>
                <Button
                  color="primary"
                  onPress={() => void handleSubmit()}
                  isDisabled={submitDisabled}
                  isLoading={submitting}
                >
                  提交
                </Button>
              </>
            )}
          </ModalFooter>
        </ModalContent>
      </Modal>

      <CaseLoginPrompt
        isOpen={login.isOpen}
        onOpenChange={login.onOpenChange}
        action="提交反馈"
      />
    </>
  )
}
