'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import {
  Button,
  Chip,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  Radio,
  RadioGroup,
  Textarea,
  useDisclosure
} from '@heroui/react'
import { Flag } from 'lucide-react'
import toast from 'react-hot-toast'
import { kunFetchPost } from '~/utils/kunFetch'
import { useUserStore } from '~/store/userStore'
import {
  CASE_CONTENT_MAX_LENGTH,
  CASE_DESCRIPTION_MIN_LENGTH,
  CASE_PUBLISHER_KINDS
} from '~/constants/case'
import { SUPPORTED_RESOURCE_LINK_MAP } from '~/constants/resource'
import { enabledIssueTriagePhenomena } from '~/constants/issueTriage'
import { CaseImageField } from './CaseImageField'
import { CaseLoginPrompt } from './CaseLoginPrompt'
import { CaseSubmitResult } from './CaseSubmitResult'
import { useCaseImageUploads } from './useCaseImageUploads'
import { LinkReportPanel } from '~/components/patch/resource/LinkReportPanel'
import { readLinkHealth } from '~/components/patch/resource/linkHealthDisplay'
import type { CaseCreateResponse } from '~/types/api/case'
import type { LinkHealthMutationResponse } from '~/types/api/linkHealth'
import type { PatchResource, PatchResourceLink } from '~/types/api/patch'

interface Props {
  resource: PatchResource
  /** 当前页面所属条目 ID，随请求作为 expectedPatchId 校验资源是否已被移动。 */
  patchId: number
  /** 链接类报告成功后上抛最新链接事实（卡片据此有序合并展示）。 */
  onReported?: (view: LinkHealthMutationResponse['link']) => void
}

type TargetSelection = 'resource' | `link:${number}` | ''

const selectionForLink = (link: PatchResourceLink): TargetSelection =>
  `link:${link.id}`

const linkLabel = (link: PatchResourceLink, index: number): string => {
  const storage = SUPPORTED_RESOURCE_LINK_MAP[link.storage] ?? link.storage
  const broken = readLinkHealth(link)?.health === 'broken'
  return `链接 #${index + 1}（${storage} · ${link.size}）${broken ? ' · 已失效' : ''}`
}

/**
 * 模块 05 的统一入口「遇到问题」：先选目标（卡片里的某条链接，含已折叠的
 * 失效链接，或整条资源），再选现象，每个现象一个去向。链接失效走模块 04
 * 的报告投票；D34/D40 的事项行与原样继承；指南现象不出现提交按钮。关闭
 * 对话框不保存草稿；服务器拒绝时保留输入。
 */
export const ReportResourceButton = ({
  resource,
  patchId,
  onReported
}: Props) => {
  const { user } = useUserStore((state) => state)
  const { isOpen, onOpen, onClose } = useDisclosure()
  const login = useDisclosure()
  const uploads = useCaseImageUploads()
  const [step, setStep] = useState<1 | 2>(1)
  const [target, setTarget] = useState<TargetSelection>('')
  const [phenomenonKey, setPhenomenonKey] = useState('')
  const [content, setContent] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [result, setResult] = useState<CaseCreateResponse | null>(null)
  const resultCloseRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (result) {
      resultCloseRef.current?.focus()
    }
  }, [result])

  const guest = user.uid < 1

  const selectedLink = useMemo(() => {
    if (!target.startsWith('link:')) {
      return null
    }
    const linkId = Number(target.slice(5))
    return resource.links.find((link) => link.id === linkId) ?? null
  }, [target, resource.links])

  const targetType = selectedLink ? 'link' : 'resource'
  const phenomena = useMemo(
    () => enabledIssueTriagePhenomena(step === 2 ? targetType : undefined),
    [step, targetType]
  )
  const phenomenon = phenomena.find((item) => item.key === phenomenonKey)
  const destination = phenomenon?.destination

  // 与资源 Tabs 官方/社区同一口径：作者 role > 2 视为官方资源，归网站管理员处理。
  const official = (resource.user?.role ?? 0) > 2
  const staffHandled =
    official ||
    (destination?.type === 'case' &&
      !(CASE_PUBLISHER_KINDS as readonly string[]).includes(destination.kind))
  const handlerHint =
    destination?.type === 'case' && destination.kind === 'content_violation'
      ? '该问题由网站管理员处理，预计首次响应在 3 天内。'
      : staffHandled
        ? '该问题由网站管理员处理，预计首次响应在 7 天内。'
        : '该问题先由资源发布者处理，预计首次响应在 7 天内；发布者 7 天未处理时会提交给网站管理员处理。'
  // 指南现象只给说明；带说明的提交现象把说明块放在处理方提示和输入框上方（D40）。
  const guideBlock =
    destination?.type === 'guide'
      ? {
          note: '这类问题不需要提交，可以先看这些说明：',
          links: destination.links
        }
      : destination?.type === 'case'
        ? destination.guide
        : undefined
  const tooShort = content.trim().length < CASE_DESCRIPTION_MIN_LENGTH

  /** 05：关闭对话框不保存草稿。 */
  const resetAll = () => {
    setStep(1)
    setTarget('')
    setPhenomenonKey('')
    setContent('')
    setResult(null)
    uploads.reset()
  }

  const handleClose = () => {
    if (submitting) return
    onClose()
    resetAll()
  }

  const handleOpen = () => {
    // 单链接的资源默认选中那条链接，界面仍显示当前所选目标。
    if (resource.links.length === 1) {
      setTarget(selectionForLink(resource.links[0]))
    }
    onOpen()
  }

  const handleBack = () => {
    setStep(1)
    setPhenomenonKey('')
  }

  const handleNext = () => {
    if (!target) return
    setStep(2)
  }

  const handleSubmitCase = async () => {
    if (destination?.type !== 'case') return
    if (guest) {
      onClose()
      resetAll()
      login.onOpen()
      return
    }
    const trimmed = content.trim()
    if (tooShort || submitting || uploads.uploading) return
    setSubmitting(true)
    try {
      const res = await kunFetchPost<CaseCreateResponse | string>('/case', {
        kind: destination.kind,
        targetType: 'resource',
        targetId: resource.id,
        expectedPatchId: patchId,
        content: trimmed,
        imageKeys: uploads.keys
      })
      if (typeof res === 'string') {
        // 业务失败（日限额、资源已被移动等）保留输入
        toast.error(res || '提交失败，请稍后重试')
        return
      }
      if (res.justClosed) {
        toast('相同问题刚刚结案，请重新提交')
        return
      }
      setResult(res)
    } catch {
      // 网络失败保留输入
      toast.error('网络错误，提交失败，请重试')
    } finally {
      setSubmitting(false)
    }
  }

  const targetSummary = selectedLink
    ? linkLabel(
        selectedLink,
        resource.links.findIndex((link) => link.id === selectedLink.id)
      )
    : `整条资源 · ${resource.name || '资源备注'}`

  // 结果页的处理方与预计首次响应按实际类型区分（content_violation 为 3 天）。
  const resultHandlerHint =
    destination?.type === 'case' && destination.kind === 'content_violation'
      ? '网站管理员，预计 3 天内首次回应'
      : `${staffHandled ? '网站管理员' : '资源发布者'}，预计 7 天内首次回应`

  return (
    <>
      <Button
        size="sm"
        variant="light"
        startContent={<Flag className="size-4" />}
        onPress={handleOpen}
      >
        遇到问题
      </Button>

      <Modal isOpen={isOpen} onClose={handleClose} scrollBehavior="inside">
        <ModalContent>
          <ModalHeader className="flex flex-col gap-1">
            遇到问题
            <span className="text-sm font-normal text-default-500">
              {resource.name}
            </span>
          </ModalHeader>
          <ModalBody>
            {result ? (
              <CaseSubmitResult result={result} handler={resultHandlerHint} />
            ) : step === 1 ? (
              <RadioGroup
                aria-label="选择遇到问题的目标"
                label="这个问题出在哪里？"
                value={target}
                onValueChange={(value) => setTarget(value as TargetSelection)}
              >
                {resource.links.map((link, index) => (
                  <Radio
                    key={link.id}
                    value={selectionForLink(link)}
                    description={
                      readLinkHealth(link)?.health === 'broken'
                        ? '已失效链接仍可选中反馈'
                        : undefined
                    }
                  >
                    {linkLabel(link, index)}
                  </Radio>
                ))}
                <Radio value="resource" description="问题不针对某一条链接">
                  整条资源
                </Radio>
              </RadioGroup>
            ) : (
              <>
                <div className="flex items-center gap-2">
                  <span className="text-sm text-default-500">当前目标</span>
                  <Chip size="sm" variant="flat">
                    {targetSummary}
                  </Chip>
                </div>

                <RadioGroup
                  aria-label="遇到的问题"
                  label="遇到了什么问题？"
                  value={phenomenonKey}
                  onValueChange={setPhenomenonKey}
                >
                  {phenomena.map((item) => (
                    <Radio
                      key={item.key}
                      value={item.key}
                      description={item.examples}
                    >
                      {item.label}
                    </Radio>
                  ))}
                </RadioGroup>

                {phenomenon?.handlerHint && (
                  <p className="text-sm text-default-500">
                    {phenomenon.handlerHint}
                  </p>
                )}

                {guideBlock && (
                  <div className="space-y-2 rounded-medium bg-default-100 p-3 text-sm">
                    <p>{guideBlock.note}</p>
                    <ul className="space-y-1">
                      {guideBlock.links.map((link) => (
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

                {destination?.type === 'link_report' && selectedLink && (
                  // 按 真实目标+版本+固定原因 记面板实例：切换现象（强/弱证据）
                  // 或换链接时整面板重建，reason 与网络确认、提交状态不串台；
                  // 链接旁快捷入口（自选 reason）不受影响
                  <LinkReportPanel
                    key={`${selectedLink.id}:${
                      readLinkHealth(selectedLink)?.version ?? 'legacy'
                    }:${destination.reason}`}
                    patchId={patchId}
                    resourceId={resource.id}
                    link={selectedLink}
                    reason={destination.reason}
                    onCancel={handleClose}
                    onLoginRequired={login.onOpen}
                    onReported={onReported}
                  />
                )}

                {destination?.type === 'case' && (
                  <div className="space-y-3">
                    <p className="text-sm text-default-500">
                      {handlerHint}
                      {staffHandled ? '网站管理员' : '发布者'}
                      能看到你的用户名和说明。
                    </p>
                    {guest ? (
                      <p className="text-sm text-default-500">
                        提交需要先登录账号。
                      </p>
                    ) : (
                      <>
                        <Textarea
                          aria-label="问题描述"
                          isRequired
                          placeholder={phenomenon?.placeholder}
                          description={`至少 ${CASE_DESCRIPTION_MIN_LENGTH} 个字符，纯文字；可以附截图`}
                          value={content}
                          onValueChange={setContent}
                          maxLength={CASE_CONTENT_MAX_LENGTH}
                          isInvalid={content.length > 0 && tooShort}
                          errorMessage={`问题描述最少 ${CASE_DESCRIPTION_MIN_LENGTH} 个字符`}
                        />
                        <CaseImageField
                          uploads={uploads}
                          isDisabled={submitting}
                        />
                      </>
                    )}
                  </div>
                )}
              </>
            )}
          </ModalBody>
          <ModalFooter>
            {result ? (
              <Button
                ref={resultCloseRef}
                variant="light"
                onPress={handleClose}
              >
                关闭
              </Button>
            ) : step === 1 ? (
              <>
                <Button variant="light" onPress={handleClose}>
                  取消
                </Button>
                <Button
                  color="primary"
                  onPress={handleNext}
                  isDisabled={!target}
                >
                  下一步
                </Button>
              </>
            ) : destination?.type === 'case' ? (
              <>
                <Button variant="light" onPress={handleBack}>
                  上一步
                </Button>
                <Button
                  variant="light"
                  onPress={handleClose}
                  isDisabled={submitting}
                >
                  取消
                </Button>
                <Button
                  color="primary"
                  onPress={() => void handleSubmitCase()}
                  isDisabled={
                    !guest && (tooShort || submitting || uploads.uploading)
                  }
                  isLoading={submitting}
                >
                  {guest ? '登录后提交' : '提交'}
                </Button>
              </>
            ) : destination?.type === 'link_report' ? (
              <Button variant="light" onPress={handleBack}>
                上一步
              </Button>
            ) : (
              <>
                <Button variant="light" onPress={handleBack}>
                  上一步
                </Button>
                <Button variant="light" onPress={handleClose}>
                  关闭
                </Button>
              </>
            )}
          </ModalFooter>
        </ModalContent>
      </Modal>

      <CaseLoginPrompt
        isOpen={login.isOpen}
        onOpenChange={login.onOpenChange}
        action="报告问题"
      />
    </>
  )
}
