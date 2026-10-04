'use client'

import { useEffect, useRef, useState } from 'react'
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
import { enabledIssueTriagePhenomena } from '~/constants/issueTriage'
import { CaseImageField } from './CaseImageField'
import { CaseLoginPrompt } from './CaseLoginPrompt'
import { CaseSubmitResult } from './CaseSubmitResult'
import { useCaseImageUploads } from './useCaseImageUploads'
import type { CaseCreateResponse } from '~/types/api/case'
import type { PatchResource } from '~/types/api/patch'

interface Props {
  resource: PatchResource
  /** 当前页面所属条目 ID，随请求作为 expectedPatchId 校验资源是否已被移动。 */
  patchId: number
}

const PHENOMENA = enabledIssueTriagePhenomena()

export const ReportResourceButton = ({ resource, patchId }: Props) => {
  const { user } = useUserStore((state) => state)
  const { isOpen, onOpen, onClose } = useDisclosure()
  const login = useDisclosure()
  const uploads = useCaseImageUploads()
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
  const phenomenon = PHENOMENA.find((item) => item.key === phenomenonKey)
  const destination = phenomenon?.destination
  // 与资源 Tabs 官方/社区同一口径：作者 role > 2 视为官方资源，归网站管理员处理。
  const official = (resource.user?.role ?? 0) > 2
  // CASE_PUBLISHER_KINDS 内的现象先交资源发布者（与描述不符、链接失效、解压
  // 或运行、求资源或催更、资源其他）；发错条目等其余事项始终由网站管理员处理。
  const staffHandled =
    official ||
    (destination?.type === 'case' &&
      !(CASE_PUBLISHER_KINDS as readonly string[]).includes(destination.kind))
  const handlerHint = staffHandled
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

  const handleClose = () => {
    if (submitting) return
    // 提交成功后收起即清空；取消时保留草稿，重新打开可以接着写
    if (result) {
      setResult(null)
      setPhenomenonKey('')
      setContent('')
      uploads.reset()
    }
    onClose()
  }

  const handleSubmit = async () => {
    if (destination?.type !== 'case') return
    if (guest) {
      onClose()
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

  return (
    <>
      <Button
        size="sm"
        variant="light"
        startContent={<Flag className="size-4" />}
        onPress={onOpen}
      >
        报告问题
      </Button>

      <Modal isOpen={isOpen} onClose={handleClose} scrollBehavior="inside">
        <ModalContent>
          <ModalHeader className="flex flex-col gap-1">
            报告问题
            <span className="text-sm font-normal text-default-500">
              {resource.name}
            </span>
          </ModalHeader>
          <ModalBody>
            {result ? (
              <CaseSubmitResult
                result={result}
                handler={`${staffHandled ? '网站管理员' : '资源发布者'}，预计 7 天内首次回应`}
              />
            ) : (
              <>
                <RadioGroup
                  aria-label="遇到的问题"
                  label="遇到了什么问题？"
                  value={phenomenonKey}
                  onValueChange={setPhenomenonKey}
                >
                  {PHENOMENA.map((item) => (
                    <Radio
                      key={item.key}
                      value={item.key}
                      description={item.examples}
                    >
                      {item.label}
                    </Radio>
                  ))}
                </RadioGroup>

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
            {result || destination?.type !== 'case' ? (
              <Button
                ref={resultCloseRef}
                variant="light"
                onPress={handleClose}
              >
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
                  isDisabled={
                    !guest && (tooShort || submitting || uploads.uploading)
                  }
                  isLoading={submitting}
                >
                  {guest ? '登录后提交' : '提交'}
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
