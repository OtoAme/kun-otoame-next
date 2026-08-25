'use client'

import { useMemo, useState } from 'react'
import {
  Avatar,
  Button,
  Card,
  CardBody,
  CardHeader,
  Chip,
  Divider,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  Switch,
  Textarea
} from '@heroui/react'
import Link from 'next/link'
import DOMPurify from 'isomorphic-dompurify'
import toast from 'react-hot-toast'
import { useRouter } from '@bprogress/next'
import { KunImageViewer } from '~/components/kun/image-viewer/ImageViewer'
import { NSFWMask } from '~/components/kun/NSFWMask'
import { kunFetchPost } from '~/utils/kunFetch'
import { PATCH_SUBMISSION_REASON_MAX_LENGTH } from '~/constants/patchSubmission'
import type { AdminPatchSubmissionDetail } from '~/app/api/admin/patch-submission/service'

type ReviewAction = 'approve' | 'reject' | 'request-changes' | 'violate'

const ACTION_LABEL: Record<ReviewAction, string> = {
  approve: '通过并发布',
  reject: '驳回并返还押金',
  'request-changes': '要求修改',
  violate: '判定违规并扣除押金'
}

const ACTION_HINT: Record<ReviewAction, string> = {
  approve: '将按当前预览创建正式条目，并返还押金与发放投稿奖励。',
  reject: '用于重复、超出收录范围或诚实但无法发布的投稿。押金全额返还。',
  'request-changes': '投稿回到作者手中继续编辑，押金保持暂扣。',
  violate: '仅用于违规内容。押金被扣除，作者可见内容与素材立即下架。'
}

const STATUS_LABEL: Record<AdminPatchSubmissionDetail['status'], string> = {
  draft: '草稿',
  pending: '待审核',
  changes_requested: '要求修改',
  rejected: '已驳回',
  published: '已发布',
  violation: '违规关闭',
  deleted: '已删除'
}

const formatDateTime = (value: string | null) =>
  value ? new Date(value).toLocaleString('zh-CN') : '—'

const DetailChips = ({ values }: { values: string[] }) =>
  values.length ? (
    <div className="flex flex-wrap gap-2">
      {values.map((value) => (
        <Chip key={value} size="sm" variant="flat">
          {value}
        </Chip>
      ))}
    </div>
  ) : (
    <span className="text-sm text-default-400">无</span>
  )

const GalleryItem = ({
  image,
  onOpen
}: {
  image: NonNullable<AdminPatchSubmissionDetail['preview']>['gallery'][number]
  onOpen: () => void
}) => {
  const [revealed, setRevealed] = useState(!image.isNSFW)

  if (!image.imageUrl) return null

  return (
    <button
      type="button"
      className="group relative aspect-video overflow-hidden rounded-lg bg-default-100 text-left"
      onClick={() => revealed && onOpen()}
    >
      <img
        src={image.thumbnailUrl ?? image.imageUrl}
        alt="投稿截图"
        className="size-full object-cover transition-transform duration-300 group-hover:scale-105"
        loading="lazy"
      />
      <NSFWMask isVisible={!revealed} onReveal={() => setRevealed(true)} />
    </button>
  )
}

interface Props {
  submission: AdminPatchSubmissionDetail
  reviewerId: number
  reviewerRole: number
}

export const AdminSubmissionDetail = ({
  submission,
  reviewerId,
  reviewerRole
}: Props) => {
  const router = useRouter()
  const [pendingAction, setPendingAction] = useState<ReviewAction | null>(null)
  const [reason, setReason] = useState('')
  const [working, setWorking] = useState(false)
  const [overrideSelfReview, setOverrideSelfReview] = useState(false)
  const preview = submission.preview
  const isSelfReview = reviewerId === submission.author.id
  const canOverrideSelfReview = isSelfReview && reviewerRole >= 4
  const sanitizedIntroduction = useMemo(
    () => DOMPurify.sanitize(preview?.introductionHtml ?? ''),
    [preview?.introductionHtml]
  )

  const openAction = (action: ReviewAction) => {
    setPendingAction(action)
    setReason('')
  }

  const runAction = async () => {
    if (!pendingAction) return
    setWorking(true)
    try {
      const response = await kunFetchPost<string | Record<string, unknown>>(
        `/admin/patch-submission/${pendingAction}`,
        {
          submissionId: submission.id,
          overrideSelfReview: canOverrideSelfReview && overrideSelfReview,
          ...(pendingAction === 'approve' ? {} : { reason: reason.trim() })
        }
      )
      if (typeof response === 'string') {
        toast.error(response)
        return
      }
      toast.success(pendingAction === 'approve' ? '已通过并发布' : '投稿已处理')
      setPendingAction(null)
      setReason('')
      router.refresh()
    } catch (error) {
      console.error('Failed to review a submission', error)
      toast.error('操作失败，请检查网络后重试')
    } finally {
      setWorking(false)
    }
  }

  const externalIds = preview
    ? [
        ['VNDB', preview.externalIds.vndbId],
        ['VNDB Release', preview.externalIds.vndbRelationId],
        ['Bangumi', preview.externalIds.bangumiId],
        ['Steam', preview.externalIds.steamId],
        ['DLsite', preview.externalIds.dlsiteCode]
      ].filter((entry): entry is [string, string] => Boolean(entry[1]))
    : []
  const validGallery = preview?.gallery.filter((image) => image.imageUrl) ?? []

  return (
    <div className="mx-auto w-full max-w-6xl space-y-4 py-4">
      <div className="flex flex-wrap items-center gap-3">
        <Button as={Link} href="/admin/submission" size="sm" variant="flat">
          返回审核队列
        </Button>
        <Chip color="primary" variant="flat">
          {STATUS_LABEL[submission.status]}
        </Chip>
        <span className="text-sm text-default-500">投稿 #{submission.id}</span>
      </div>

      <Card>
        <CardHeader className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-medium">
              {preview?.name || submission.name}
            </h1>
            <p className="mt-1 text-sm text-default-500">
              提交于 {formatDateTime(submission.submittedAt)}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <Avatar
              size="sm"
              src={submission.author.avatar}
              name={submission.author.name}
            />
            <div className="text-sm">
              <Link
                href={`/user/${submission.author.id}`}
                className="text-primary hover:underline"
              >
                {submission.author.name}
              </Link>
              <p className="text-default-500">
                暂扣 {submission.heldAmount} 萌萌点
              </p>
            </div>
          </div>
        </CardHeader>
        <Divider />
        <CardBody className="space-y-8">
          {!preview ? (
            <p className="text-sm text-default-500">
              该投稿的正文已经清除或 payload 无法读取，没有可展示的发布预览。
            </p>
          ) : (
            <>
              <section className="grid gap-5 md:grid-cols-2">
                <div className="space-y-2">
                  <h2 className="text-lg font-medium">外部 ID</h2>
                  {externalIds.length ? (
                    <div className="space-y-1 text-sm">
                      {externalIds.map(([label, value]) => (
                        <p key={label}>
                          <span className="inline-block w-28 text-default-500">
                            {label}
                          </span>
                          {value}
                        </p>
                      ))}
                    </div>
                  ) : (
                    <span className="text-sm text-default-400">无</span>
                  )}
                </div>
                <div className="space-y-1 text-sm">
                  <h2 className="mb-2 text-lg font-medium">发布属性</h2>
                  <p>
                    <span className="inline-block w-24 text-default-500">
                      发售日
                    </span>
                    {preview.released}
                  </p>
                  <p>
                    <span className="inline-block w-24 text-default-500">
                      内容分级
                    </span>
                    {preview.contentLimit.toUpperCase()}
                  </p>
                  <p>
                    <span className="inline-block w-24 text-default-500">
                      官网
                    </span>
                    {preview.officialUrl ? (
                      <a
                        href={preview.officialUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="break-all text-primary hover:underline"
                      >
                        {preview.officialUrl}
                      </a>
                    ) : (
                      '无'
                    )}
                  </p>
                </div>
              </section>

              <section className="space-y-2">
                <h2 className="text-lg font-medium">别名</h2>
                <DetailChips values={preview.aliases} />
              </section>
              <section className="space-y-2">
                <h2 className="text-lg font-medium">标签</h2>
                <DetailChips values={preview.tagNames} />
              </section>
              <section className="space-y-2">
                <h2 className="text-lg font-medium">公司 / 社团</h2>
                <DetailChips values={preview.companyNames} />
              </section>

              {preview.bannerUrl && (
                <section className="space-y-2">
                  <h2 className="text-lg font-medium">封面</h2>
                  <img
                    src={preview.bannerUrl}
                    alt={`${preview.name} 封面`}
                    className="max-h-[34rem] max-w-full rounded-lg object-contain"
                  />
                </section>
              )}

              <section className="space-y-2">
                <h2 className="text-lg font-medium">正文</h2>
                <div
                  className="kun-prose max-w-none rounded-lg bg-content2 p-4"
                  dangerouslySetInnerHTML={{ __html: sanitizedIntroduction }}
                />
              </section>

              {validGallery.length > 0 && (
                <section className="space-y-2">
                  <h2 className="text-lg font-medium">截图</h2>
                  <KunImageViewer
                    preload={2}
                    images={validGallery.map((image) => ({
                      src: image.imageUrl as string,
                      previewSrc: image.thumbnailUrl ?? undefined,
                      alt: '投稿截图'
                    }))}
                  >
                    {(openLightbox) => (
                      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
                        {validGallery.map((image, index) => (
                          <GalleryItem
                            key={image.id ?? image.imageUrl}
                            image={image}
                            onOpen={() => openLightbox(index)}
                          />
                        ))}
                      </div>
                    )}
                  </KunImageViewer>
                </section>
              )}
            </>
          )}

          <Divider />
          <section className="grid gap-2 text-sm md:grid-cols-2">
            <p>
              <span className="text-default-500">payload 版本：</span>
              {submission.payloadVersion}
            </p>
            <p>
              <span className="text-default-500">创建时间：</span>
              {formatDateTime(submission.created)}
            </p>
            {submission.externalSource && (
              <p>
                <span className="text-default-500">外部数据来源：</span>
                {submission.externalSource}
                {submission.externalFetchedAt
                  ? `（${formatDateTime(submission.externalFetchedAt)}）`
                  : ''}
              </p>
            )}
            {submission.reviewedBy && (
              <p>
                <span className="text-default-500">审核人：</span>
                {submission.reviewedBy.name}（
                {formatDateTime(submission.reviewedAt)}）
              </p>
            )}
            {submission.reviewReason && (
              <p className="md:col-span-2">
                <span className="text-default-500">审核原因：</span>
                {submission.reviewReason}
              </p>
            )}
          </section>
        </CardBody>
      </Card>

      {submission.status === 'pending' && (
        <Card>
          <CardHeader>
            <h2 className="text-lg font-medium">审核操作</h2>
          </CardHeader>
          <CardBody className="space-y-3">
            {isSelfReview && reviewerRole < 4 && (
              <p className="text-sm text-danger">不能审核自己的投稿。</p>
            )}
            {canOverrideSelfReview && (
              <Switch
                isSelected={overrideSelfReview}
                onValueChange={setOverrideSelfReview}
              >
                允许超级管理员自审（操作会写入审计日志）
              </Switch>
            )}
            <div className="flex flex-wrap gap-2">
              <Button
                color="success"
                variant="flat"
                isDisabled={
                  isSelfReview &&
                  (!canOverrideSelfReview || !overrideSelfReview)
                }
                onPress={() => openAction('approve')}
              >
                通过
              </Button>
              <Button
                variant="flat"
                isDisabled={
                  isSelfReview &&
                  (!canOverrideSelfReview || !overrideSelfReview)
                }
                onPress={() => openAction('request-changes')}
              >
                要求修改
              </Button>
              <Button
                variant="flat"
                isDisabled={
                  isSelfReview &&
                  (!canOverrideSelfReview || !overrideSelfReview)
                }
                onPress={() => openAction('reject')}
              >
                驳回
              </Button>
              <Button
                color="danger"
                variant="flat"
                isDisabled={
                  isSelfReview &&
                  (!canOverrideSelfReview || !overrideSelfReview)
                }
                onPress={() => openAction('violate')}
              >
                违规
              </Button>
            </div>
          </CardBody>
        </Card>
      )}

      <Modal
        isOpen={pendingAction !== null}
        onClose={() => !working && setPendingAction(null)}
      >
        <ModalContent>
          <ModalHeader>
            {pendingAction ? ACTION_LABEL[pendingAction] : ''}
          </ModalHeader>
          <ModalBody className="space-y-3">
            <p className="text-sm text-default-500">
              {pendingAction ? ACTION_HINT[pendingAction] : ''}
            </p>
            {pendingAction && pendingAction !== 'approve' && (
              <Textarea
                isRequired
                label="原因（会发送给投稿人）"
                maxLength={PATCH_SUBMISSION_REASON_MAX_LENGTH}
                value={reason}
                onValueChange={setReason}
              />
            )}
          </ModalBody>
          <ModalFooter>
            <Button variant="light" onPress={() => setPendingAction(null)}>
              取消
            </Button>
            <Button
              color={pendingAction === 'violate' ? 'danger' : 'primary'}
              isLoading={working}
              isDisabled={
                pendingAction !== 'approve' && reason.trim().length === 0
              }
              onPress={() => void runAction()}
            >
              确认
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </div>
  )
}
