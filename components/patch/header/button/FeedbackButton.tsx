'use client'

import { useState } from 'react'
import Link from 'next/link'
import {
  Button,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  Radio,
  RadioGroup,
  Textarea,
  Tooltip,
  useDisclosure
} from '@heroui/react'
import { MessageCircleQuestion } from 'lucide-react'
import toast from 'react-hot-toast'
import { kunFetchPost } from '~/utils/kunFetch'
import { useUserStore } from '~/store/userStore'
import {
  CASE_CONTENT_MAX_LENGTH,
  CASE_DESCRIPTION_MIN_LENGTH
} from '~/constants/case'
import {
  REQUEST_RESOURCE_GUIDE_LINKS,
  REQUEST_RESOURCE_GUIDE_NOTE
} from '~/constants/issueTriage'
import { CaseImageField } from '~/components/case/CaseImageField'
import { CaseLoginPrompt } from '~/components/case/CaseLoginPrompt'
import { CaseSubmitResult } from '~/components/case/CaseSubmitResult'
import { useCaseImageUploads } from '~/components/case/useCaseImageUploads'
import type { CaseCreateResponse } from '~/types/api/case'
import type { Patch } from '~/types/api/patch'

interface Props {
  patch: Patch
  /** Opens the 资源链接 tab, where wrong-patch and link-failure resources are reported. */
  onOpenResources: () => void
}

type CaseOption = 'patch_info' | 'other'
// 指引项不建事项：发错条目、链接失效在那条资源的卡片上报告，求资源看贡献指南
type ResourceGuideOption = 'resource_wrong_patch' | 'resource_link_failure'
type GuideOption = ResourceGuideOption | 'request_resource'
type FeedbackOption = CaseOption | GuideOption

const isCaseOption = (option: FeedbackOption): option is CaseOption =>
  option === 'patch_info' || option === 'other'

const isResourceGuideOption = (
  option: FeedbackOption
): option is ResourceGuideOption =>
  option === 'resource_wrong_patch' || option === 'resource_link_failure'

// 旧反馈入口在条目页，资源问题改到资源卡片「报告问题」里提交（D34、D38）
const RESOURCE_GUIDES: Record<ResourceGuideOption, string> = {
  resource_wrong_patch:
    '资源发错条目请在那条资源上报告：打开「资源链接」，在资源卡片上点「报告问题」，选择「发在了错误的条目下」。网站管理员核对后会把资源移到正确的游戏。',
  resource_link_failure:
    '资源链接失效请在那条资源上报告：打开「资源链接」，在资源卡片上点「报告问题」，选择「链接失效」并写明是哪条链接。问题会先交给资源发布者补链，官方资源由网站管理员处理。'
}

// 处理方与预计首次响应沿用基线 8.6 的受理范围口径
const OPTION_HINTS: Record<CaseOption, string> = {
  patch_info:
    '由网站管理员核对后修改，预计首次响应在 7 天内。和其他条目重复也选这一项，写明重复的条目链接。',
  other: '其他与该游戏相关的问题，由网站管理员处理，不承诺首次响应时限。'
}

const OPTION_HANDLERS: Record<CaseOption, string> = {
  patch_info: '网站管理员，预计 7 天内首次回应',
  other: '网站管理员'
}

const OPTION_PLACEHOLDERS: Record<CaseOption, string> = {
  patch_info:
    '哪一项资料有误（如发售日期、会社、简介），正确内容是……，来源是……',
  other: '请描述遇到的问题'
}

export const FeedbackButton = ({ patch, onOpenResources }: Props) => {
  const { user } = useUserStore((state) => state)
  const { isOpen, onOpen, onClose } = useDisclosure()
  const login = useDisclosure()
  const uploads = useCaseImageUploads()
  const [option, setOption] = useState<FeedbackOption>('patch_info')
  const [content, setContent] = useState('')
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
      uploads.reset()
    }
    onClose()
  }

  const handleOpenResources = () => {
    setOption('patch_info')
    onClose()
    onOpenResources()
  }

  const tooShort = content.trim().length < CASE_DESCRIPTION_MIN_LENGTH

  const handleSubmit = async () => {
    if (!isCaseOption(option)) return
    if (tooShort || submitting || uploads.uploading) return
    setSubmitting(true)
    try {
      const res = await kunFetchPost<CaseCreateResponse | string>('/case', {
        kind: option,
        targetType: 'patch',
        targetId: patch.id,
        content: content.trim(),
        imageKeys: uploads.keys
      })
      if (typeof res === 'string') {
        // 业务失败（条目不可用等）保留输入
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
            {result && isCaseOption(option) ? (
              <CaseSubmitResult
                result={result}
                handler={OPTION_HANDLERS[option]}
              />
            ) : (
              <>
                <RadioGroup
                  aria-label="反馈类型"
                  value={option}
                  onValueChange={(value) => setOption(value as FeedbackOption)}
                >
                  <Radio value="patch_info">条目资料有误</Radio>
                  <Radio value="resource_wrong_patch">资源发错条目</Radio>
                  <Radio value="resource_link_failure">资源链接失效</Radio>
                  <Radio value="request_resource">求资源或催更</Radio>
                  <Radio value="other">其他</Radio>
                </RadioGroup>

                {isResourceGuideOption(option) && (
                  <div className="space-y-2 rounded-medium bg-default-100 p-3 text-sm">
                    <p>{RESOURCE_GUIDES[option]}</p>
                    <Button
                      size="sm"
                      color="primary"
                      variant="flat"
                      onPress={handleOpenResources}
                    >
                      去资源链接
                    </Button>
                  </div>
                )}

                {option === 'request_resource' && (
                  <div className="space-y-2 rounded-medium bg-default-100 p-3 text-sm">
                    <p>{REQUEST_RESOURCE_GUIDE_NOTE}</p>
                    <ul className="space-y-1">
                      {REQUEST_RESOURCE_GUIDE_LINKS.map((link) => (
                        <li key={link.href}>
                          <Link
                            href={link.href}
                            target="_blank"
                            className="text-primary underline-offset-2 hover:underline"
                          >
                            {link.label}
                          </Link>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {isCaseOption(option) && (
                  <>
                    <p className="text-sm text-default-500">
                      {OPTION_HINTS[option]}
                      {option === 'patch_info' && user.role > 2
                        ? '你也可以直接用「编辑游戏信息」修改。'
                        : ''}
                    </p>
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
              </>
            )}
          </ModalBody>
          <ModalFooter>
            {result || !isCaseOption(option) ? (
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
                  isDisabled={submitting || uploads.uploading || tooShort}
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
