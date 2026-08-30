'use client'

import { useEffect, useRef, useState } from 'react'
import {
  Button,
  Card,
  CardBody,
  CardHeader,
  Chip,
  Input,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader
} from '@heroui/react'
import { useRouter } from '@bprogress/next'
import toast from 'react-hot-toast'
import { kunFetchPost } from '~/utils/kunFetch'
import { applySteamOfficialUrlFallback } from '~/utils/externalIds'
import { usePatchSubmissionStore } from '~/store/patchSubmissionStore'
import { usePatchSubmissionAutosave } from '~/hooks/usePatchSubmissionAutosave'
import {
  SubmissionBannerInput,
  type SubmissionBannerHandle
} from './SubmissionBannerInput'
import {
  SubmissionGalleryInput,
  type SubmissionGalleryHandle
} from './SubmissionGalleryInput'
import { SubmissionPreview } from './SubmissionPreview'
import { SubmissionAliasInput } from './SubmissionAliasInput'
import { SubmissionContentLimit } from './SubmissionContentLimit'
import { SubmissionIntroduction } from './SubmissionIntroduction'
import { VNDBInput } from '~/components/edit/create/VNDBInput'
import { VNDBRelationInput } from '~/components/edit/create/VNDBRelationInput'
import { BangumiInput } from '~/components/edit/components/BangumiInput'
import { SteamInput } from '~/components/edit/components/SteamInput'
import { ReleaseDateInput } from '~/components/edit/components/ReleaseDateInput'
import { BatchTag } from '~/components/edit/components/BatchTag'
import type {
  PatchSubmission,
  PatchSubmissionPayload
} from '~/types/api/patchSubmission'

const SAVE_LABEL: Record<string, string> = {
  idle: '',
  saving: '正在保存 ...',
  saved: '已保存到云端',
  error: '保存失败',
  conflict: '在其他设备上被修改'
}

interface Props {
  submission: PatchSubmission
}

export const SubmissionEditor = ({ submission }: Props) => {
  const router = useRouter()
  const {
    payload,
    setPayload,
    status,
    saveState,
    saveError,
    hydrate,
    submissionId,
    setExternalProvenance,
    localAssetCount,
    assetUploadsInFlight,
    assetDraftLoaded
  } = usePatchSubmissionStore()
  const { queueSave, flush } = usePatchSubmissionAutosave()
  const galleryRef = useRef<SubmissionGalleryHandle>(null)
  const bannerRef = useRef<SubmissionBannerHandle>(null)
  const [nameError, setNameError] = useState('')
  /** Which action is waiting on the unsaved-cover question, if any. */
  const [bannerPrompt, setBannerPrompt] = useState<'draft' | 'submit' | null>(
    null
  )
  const [bannerUploading, setBannerUploading] = useState(false)

  useEffect(() => {
    hydrate(submission)
    setNameError('')
    setBannerPrompt(null)
  }, [submission, hydrate])

  // hydrate lands in an effect, so the first paint would otherwise show the
  // store's empty defaults and flash a blank form over saved content.
  const hydrated = submissionId === submission.id
  const form = hydrated ? payload : submission.payload
  const currentStatus = hydrated ? status : submission.status
  const editable =
    currentStatus === 'draft' || currentStatus === 'changes_requested'

  const update = (
    next:
      | PatchSubmissionPayload
      | ((current: PatchSubmissionPayload) => PatchSubmissionPayload)
  ) => {
    if (!editable) return

    const resolved =
      typeof next === 'function'
        ? next(usePatchSubmissionStore.getState().payload)
        : next
    setPayload(resolved)
    queueSave(resolved)
  }

  const markExternalFetched = (source: 'vndb' | 'bangumi' | 'steam') => {
    if (!editable) return
    setExternalProvenance(source, new Date().toISOString())
  }

  const flushDraft = async () => {
    const payloadResult = await flush()
    if (!payloadResult.ok) return payloadResult
    return galleryRef.current?.flushOrder() ?? { ok: true as const }
  }

  const runSubmit = async () => {
    const saved = await flushDraft()
    if (!saved.ok) {
      toast.error(saved.message)
      return
    }

    const response = await kunFetchPost<string | Record<string, never>>(
      `/patch-submission/${submissionId}/submit`
    )
    if (typeof response === 'string') {
      toast.error(response)
      return
    }
    toast.success('已提交, 请等待管理员审核')
    router.refresh()
  }

  const submit = async () => {
    if (!usePatchSubmissionStore.getState().payload.name.trim()) {
      setNameError('游戏名称是必填项')
      toast.error('请填写游戏名称')
      return
    }
    if (!assetDraftLoaded || localAssetCount > 0 || assetUploadsInFlight > 0) {
      toast.error('请先完成或移除待上传的截图')
      return
    }
    if (bannerRef.current?.hasUnsavedBanner()) {
      setBannerPrompt('submit')
      return
    }
    await runSubmit()
  }

  const runSaveDraft = async () => {
    const result = await flushDraft()
    if (result.ok) toast.success('草稿已保存到云端')
    else toast.error(result.message)
  }

  const saveDraft = async () => {
    if (bannerRef.current?.hasUnsavedBanner()) {
      setBannerPrompt('draft')
      return
    }
    await runSaveDraft()
  }

  /**
   * A cropped cover that was never uploaded exists only in the banner input's
   * state: saving the draft stores everything *except* it, and the next reload
   * has nothing to restore. So the two actions that look like "my work is safe
   * now" stop and ask instead of walking past it. Skipping is still allowed —
   * replacing an existing cover is a legitimate thing to abandon.
   */
  const continueBannerPrompt = async (uploadFirst: boolean) => {
    const pending = bannerPrompt
    if (!pending) return

    if (uploadFirst) {
      setBannerUploading(true)
      const uploaded = await bannerRef.current?.upload()
      setBannerUploading(false)
      // The banner input has already said why; leave the dialog up so the author
      // can retry or choose to go on without the cover.
      if (!uploaded) return
    }

    setBannerPrompt(null)
    if (pending === 'draft') await runSaveDraft()
    else await runSubmit()
  }

  const withdraw = async () => {
    const response = await kunFetchPost<string | Record<string, never>>(
      `/patch-submission/${submissionId}/withdraw`
    )
    if (typeof response === 'string') {
      toast.error(response)
      return
    }
    toast.success('已撤回, 可以继续编辑')
    router.refresh()
  }

  return (
    <div className="mx-auto w-full max-w-5xl space-y-4 py-4">
      {currentStatus === 'changes_requested' && submission.reviewReason && (
        <Card className="border border-warning-300 bg-warning-50">
          <CardBody className="text-sm text-warning-700">
            管理员要求修改：{submission.reviewReason}
          </CardBody>
        </Card>
      )}

      <Card>
        <CardHeader className="flex items-center justify-between">
          <h1 className="text-2xl">投稿游戏条目</h1>
          <div className="flex items-center gap-2">
            {saveState !== 'idle' && (
              <Chip
                size="sm"
                variant="flat"
                color={
                  saveState === 'saved'
                    ? 'success'
                    : saveState === 'saving'
                      ? 'default'
                      : 'danger'
                }
              >
                {saveError || SAVE_LABEL[saveState]}
              </Chip>
            )}
            <Chip size="sm" variant="flat">
              暂扣 {submission.heldAmount} 萌萌点
            </Chip>
          </div>
        </CardHeader>

        <CardBody className="space-y-8">
          <Input
            isRequired
            label="游戏名称"
            value={form.name}
            isReadOnly={!editable}
            isInvalid={Boolean(nameError)}
            errorMessage={nameError}
            onValueChange={(name) => {
              setNameError('')
              update({ ...form, name })
            }}
          />

          <VNDBInput
            errors={undefined}
            data={form}
            setData={update}
            // Pressing 获取 VNDB 数据 reveals the confirmation box when the id is
            // already taken; without these the box rendered but could not be
            // ticked, and submission blocks until it is.
            isDuplicate={form.isDuplicate}
            onDuplicateChange={(isDuplicate) =>
              update({ ...form, isDuplicate })
            }
            onExternalFetched={markExternalFetched}
            isReadOnly={!editable}
          />
          <VNDBRelationInput
            errors={undefined}
            data={form}
            setData={update}
            isReadOnly={!editable}
          />
          <BangumiInput
            errors={undefined}
            data={form}
            setData={update}
            onExternalFetched={markExternalFetched}
            isReadOnly={!editable}
          />
          <SteamInput
            errors={undefined}
            data={form}
            setData={update}
            onExternalFetched={markExternalFetched}
            isReadOnly={!editable}
          />

          <SubmissionBannerInput ref={bannerRef} editable={editable} />

          <SubmissionIntroduction
            payload={form}
            editable={editable}
            onChange={update}
          />

          <SubmissionGalleryInput ref={galleryRef} />

          <SubmissionAliasInput
            payload={form}
            editable={editable}
            onChange={update}
          />

          <div className="space-y-2">
            <h2 className="text-xl">官方链接 (可选)</h2>
            <Input
              placeholder="输入 Steam 商店链接或官方网站链接"
              value={applySteamOfficialUrlFallback(
                form.officialUrl,
                form.steamId
              )}
              isReadOnly={!editable}
              onValueChange={(officialUrl) => update({ ...form, officialUrl })}
            />
          </div>

          <ReleaseDateInput
            date={form.released}
            setDate={(released) => update({ ...form, released })}
            isReadOnly={!editable}
          />

          <BatchTag
            data={form}
            saveTag={(tag) => update({ ...form, tag })}
            isReadOnly={!editable}
          />

          <SubmissionContentLimit
            payload={form}
            editable={editable}
            onChange={update}
          />

          <div className="flex flex-wrap gap-2">
            {editable && (
              <Button variant="flat" onPress={() => void saveDraft()}>
                保存草稿
              </Button>
            )}
            {/* The preview stays available after submission, so the author can
                re-check the pending entry and withdraw if something is wrong. */}
            {(editable || currentStatus === 'pending') && (
              <SubmissionPreview
                submissionId={submission.id}
                flush={flushDraft}
                submitted={!editable}
              />
            )}
            {editable && (
              <Button
                color="primary"
                isDisabled={
                  !assetDraftLoaded ||
                  localAssetCount > 0 ||
                  assetUploadsInFlight > 0
                }
                onPress={() => void submit()}
              >
                提交审核
              </Button>
            )}
            {currentStatus === 'pending' && (
              <Button variant="bordered" onPress={() => void withdraw()}>
                撤回投稿
              </Button>
            )}
          </div>

          {editable && localAssetCount > 0 && (
            <p className="text-sm text-warning">
              仍有 {localAssetCount} 张截图未上传,
              请在截图区点击上传按钮或移除它们后再提交。
            </p>
          )}

          {currentStatus === 'pending' && (
            <p className="text-sm text-default-500">
              投稿正在审核中, 暂时无法编辑。撤回后押金仍由这条草稿持有,
              删除草稿才会返还。
            </p>
          )}
        </CardBody>
      </Card>

      <Modal
        isOpen={bannerPrompt !== null}
        // The upload is the whole point of the dialog, so it may not be
        // dismissed out from under a request that is still running.
        isDismissable={!bannerUploading}
        isKeyboardDismissDisabled={bannerUploading}
        onOpenChange={(open) => {
          if (!open && !bannerUploading) setBannerPrompt(null)
        }}
      >
        <ModalContent>
          <ModalHeader>封面还没有上传</ModalHeader>
          <ModalBody className="text-sm text-default-600">
            您裁剪好的封面只保存在这个页面上, 刷新或离开后会丢失。
            {bannerPrompt === 'submit'
              ? ' 投稿必须有封面才能通过审核, 建议先上传。'
              : ' 建议先上传封面, 再保存草稿。'}
          </ModalBody>
          <ModalFooter>
            <Button
              variant="light"
              isDisabled={bannerUploading}
              onPress={() => setBannerPrompt(null)}
            >
              取消
            </Button>
            <Button
              variant="flat"
              isDisabled={bannerUploading}
              onPress={() => void continueBannerPrompt(false)}
            >
              {bannerPrompt === 'submit' ? '直接提交' : '仅保存草稿'}
            </Button>
            <Button
              color="primary"
              isLoading={bannerUploading}
              onPress={() => void continueBannerPrompt(true)}
            >
              {bannerPrompt === 'submit' ? '上传封面并提交' : '上传封面并保存'}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </div>
  )
}
