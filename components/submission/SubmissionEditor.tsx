'use client'

import { useEffect } from 'react'
import {
  Button,
  Card,
  CardBody,
  CardHeader,
  Chip,
  Input,
  Textarea
} from '@heroui/react'
import { useRouter } from '@bprogress/next'
import toast from 'react-hot-toast'
import { kunFetchPost } from '~/utils/kunFetch'
import { usePatchSubmissionStore } from '~/store/patchSubmissionStore'
import { usePatchSubmissionAutosave } from '~/hooks/usePatchSubmissionAutosave'
import { SubmissionBannerInput } from './SubmissionBannerInput'
import { SubmissionGalleryInput } from './SubmissionGalleryInput'
import { SubmissionPreview } from './SubmissionPreview'
import { VNDBInput } from '~/components/edit/create/VNDBInput'
import { VNDBRelationInput } from '~/components/edit/create/VNDBRelationInput'
import { BangumiInput } from '~/components/edit/components/BangumiInput'
import { SteamInput } from '~/components/edit/components/SteamInput'
import { ReleaseDateInput } from '~/components/edit/components/ReleaseDateInput'
import { BatchTag } from '~/components/edit/components/BatchTag'
import { SortableAliasChips } from '~/components/edit/components/SortableAliasChips'
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
    submissionId
  } = usePatchSubmissionStore()
  const { queueSave, flush } = usePatchSubmissionAutosave()

  useEffect(() => {
    hydrate(submission)
  }, [submission, hydrate])

  // hydrate lands in an effect, so the first paint would otherwise show the
  // store's empty defaults and flash a blank form over saved content. Until the
  // store matches this submission, render the server data directly.
  const hydrated = submissionId === submission.id
  const form = hydrated ? payload : submission.payload
  const currentStatus = hydrated ? status : submission.status
  const editable =
    currentStatus === 'draft' || currentStatus === 'changes_requested'

  /** Accepts the setter form the shared editor inputs use. */
  const update = (
    next:
      | PatchSubmissionPayload
      | ((current: PatchSubmissionPayload) => PatchSubmissionPayload)
  ) => {
    const resolved =
      typeof next === 'function'
        ? next(usePatchSubmissionStore.getState().payload)
        : next
    setPayload(resolved)
    if (editable) {
      queueSave(resolved)
    }
  }

  const submit = async () => {
    // Wait for the debounce, or the reviewer would freeze a stale payload.
    const saved = await flush()
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

  const saveDraft = async () => {
    const result = await flush()
    if (result.ok) {
      toast.success('草稿已保存到云端')
    } else {
      toast.error(result.message)
    }
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
    <div className="w-full max-w-5xl py-4 mx-auto space-y-4">
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
            onValueChange={(name) => update({ ...form, name })}
          />

          <VNDBInput errors={undefined} data={form} setData={update} />
          <VNDBRelationInput errors={undefined} data={form} setData={update} />
          <BangumiInput errors={undefined} data={form} setData={update} />
          <SteamInput errors={undefined} data={form} setData={update} />

          <div className="space-y-2">
            <h2 className="text-xl">游戏别名 (可选)</h2>
            <Input
              label="添加别名后按回车"
              isReadOnly={!editable}
              onKeyDown={(event) => {
                if (event.key !== 'Enter') {
                  return
                }
                event.preventDefault()
                const target = event.currentTarget as HTMLInputElement
                const value = target.value.trim()
                if (!value || form.alias.includes(value)) {
                  return
                }
                update({ ...form, alias: [...form.alias, value] })
                target.value = ''
              }}
            />
            <SortableAliasChips
              values={form.alias}
              onReorder={(alias) => update({ ...form, alias })}
              onRemove={(index) =>
                update({
                  ...form,
                  alias: form.alias.filter((_, at) => at !== index)
                })
              }
            />
          </div>

          <ReleaseDateInput
            date={form.released}
            setDate={(released) => update({ ...form, released })}
          />

          <BatchTag data={form} saveTag={(tag) => update({ ...form, tag })} />

          <Textarea
            isRequired
            label="游戏介绍"
            minRows={8}
            value={form.introduction}
            isReadOnly={!editable}
            onValueChange={(introduction) => update({ ...form, introduction })}
          />

          <SubmissionBannerInput />
          <SubmissionGalleryInput />

          <div className="flex gap-2">
            {editable ? (
              <>
                <Button variant="flat" onPress={() => void saveDraft()}>
                  保存草稿
                </Button>
                <SubmissionPreview submissionId={submission.id} flush={flush} />
                <Button color="primary" onPress={() => void submit()}>
                  提交审核
                </Button>
              </>
            ) : currentStatus === 'pending' ? (
              <Button variant="bordered" onPress={() => void withdraw()}>
                撤回投稿
              </Button>
            ) : null}
          </div>

          {currentStatus === 'pending' && (
            <p className="text-sm text-default-500">
              投稿正在审核中, 暂时无法编辑。撤回后押金仍由这条草稿持有,
              删除草稿才会返还。
            </p>
          )}
        </CardBody>
      </Card>
    </div>
  )
}
