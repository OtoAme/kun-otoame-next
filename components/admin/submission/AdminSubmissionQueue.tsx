'use client'

import { useEffect, useState } from 'react'
import { Button, Card, CardBody, Chip, Input, Tab, Tabs } from '@heroui/react'
import Link from 'next/link'
import { useRouter } from '@bprogress/next'
import { KunPagination } from '~/components/kun/Pagination'
import { formatChinaDateTime } from '~/utils/fixedTimezoneDate'
import {
  buildAdminSubmissionQueueUrl,
  type AdminSubmissionQueueParams
} from './queueParams'
import type { AdminSubmissionRow } from '~/app/api/admin/patch-submission/service'
import type { PatchSubmissionStatus } from '~/types/api/patchSubmission'

const STATUS_LABEL: Record<PatchSubmissionStatus, string> = {
  pending: '待审核',
  draft: '草稿',
  changes_requested: '要求修改',
  rejected: '已驳回',
  published: '已发布',
  violation: '违规关闭',
  deleted: '已删除'
}

/** The backlog leads; the rest follow the order a submission moves through. */
const STATUS_TABS: PatchSubmissionStatus[] = [
  'pending',
  'draft',
  'changes_requested',
  'rejected',
  'published',
  'violation',
  'deleted'
]

/**
 * Each status has exactly one date worth a glance: when it entered the queue,
 * when it was last edited, or when it was decided.
 */
const timeLabel = (submission: AdminSubmissionRow) => {
  if (submission.status === 'pending') {
    return submission.submittedAt
      ? formatChinaDateTime(submission.submittedAt)
      : '未提交'
  }
  if (submission.status === 'draft' || !submission.reviewedAt) {
    return `更新于 ${formatChinaDateTime(submission.updated)}`
  }
  return `审核于 ${formatChinaDateTime(submission.reviewedAt)}`
}

interface Props {
  submissions: AdminSubmissionRow[]
  total: number
  query: string
  status: PatchSubmissionStatus
  page: number
  limit: number
}

export const AdminSubmissionQueue = ({
  submissions,
  total,
  query,
  status,
  page,
  limit
}: Props) => {
  const router = useRouter()
  const [search, setSearch] = useState(query)

  // 前进后退换掉了 URL 上的搜索词, 列表已经换了一份, 输入框也得跟上。
  useEffect(() => {
    setSearch(query)
  }, [query])

  // 队列状态只存在于 URL 里, 刷新和分享出去的链接才落在同一个视图上。
  const navigate = (next: Partial<AdminSubmissionQueueParams>) =>
    router.push(buildAdminSubmissionQueueUrl({ query, status, page, ...next }))

  return (
    <div className="space-y-4">
      <Tabs
        aria-label="投稿状态"
        selectedKey={status}
        onSelectionChange={(key) => {
          const nextStatus = key.toString() as PatchSubmissionStatus
          if (nextStatus === status) {
            return
          }
          // 换状态就是换一份列表, 旧页码在新列表里没有意义。
          navigate({ status: nextStatus, page: 1 })
        }}
      >
        {STATUS_TABS.map((value) => (
          <Tab key={value} title={STATUS_LABEL[value]} />
        ))}
      </Tabs>

      <div className="flex flex-wrap items-center gap-2">
        <form
          className="flex flex-wrap items-center gap-2"
          onSubmit={(event) => {
            event.preventDefault()
            navigate({ query: search.trim(), page: 1 })
          }}
        >
          <Input
            className="max-w-sm"
            size="sm"
            label="搜索标题、投稿人或外部 ID"
            value={search}
            onValueChange={setSearch}
            isClearable
            // 只清输入框; 列表仍停在当前搜索结果上, 等提交才换视图。
            onClear={() => setSearch('')}
          />
          <Button size="sm" variant="flat" type="submit">
            搜索
          </Button>
        </form>
        <Chip size="sm" variant="flat">
          {STATUS_LABEL[status]} {total}
        </Chip>
      </div>

      {submissions.length === 0 ? (
        <p className="text-sm text-default-500">
          当前没有{STATUS_LABEL[status]}的投稿。
        </p>
      ) : (
        <div className="space-y-2">
          {submissions.map((submission) => (
            <Card key={submission.id}>
              <CardBody className="flex flex-row flex-wrap items-center gap-3">
                <span className="min-w-40 flex-1 truncate">
                  {submission.name}
                </span>
                <Link
                  href={`/user/${submission.authorId}`}
                  className="text-sm text-default-500"
                >
                  {submission.authorName}
                </Link>
                <Chip size="sm" variant="flat">
                  {timeLabel(submission)}
                </Chip>
                <Button
                  as={Link}
                  href={`/admin/submission/${submission.id}`}
                  size="sm"
                  color="primary"
                  variant="flat"
                >
                  查看
                </Button>
              </CardBody>
            </Card>
          ))}
        </div>
      )}

      {total > limit && (
        <div className="flex justify-center">
          <KunPagination
            total={Math.ceil(total / limit)}
            page={page}
            onPageChange={(nextPage) => navigate({ page: nextPage })}
          />
        </div>
      )}
    </div>
  )
}
