'use client'

import { useState } from 'react'
import { Button, Card, CardBody, Chip, Input } from '@heroui/react'
import Link from 'next/link'
import { useRouter } from '@bprogress/next'
import type { AdminSubmissionRow } from '~/app/api/admin/patch-submission/service'

interface Props {
  submissions: AdminSubmissionRow[]
  total: number
  query: string
}

export const AdminSubmissionQueue = ({ submissions, total, query }: Props) => {
  const router = useRouter()
  const [search, setSearch] = useState(query)

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          className="max-w-sm"
          size="sm"
          label="搜索标题、投稿人或外部 ID"
          value={search}
          onValueChange={setSearch}
        />
        <Button
          size="sm"
          variant="flat"
          onPress={() =>
            router.push(
              `/admin/submission?query=${encodeURIComponent(search.trim())}`
            )
          }
        >
          搜索
        </Button>
        <Chip size="sm" variant="flat">
          待审核 {total}
        </Chip>
      </div>

      {submissions.length === 0 ? (
        <p className="text-sm text-default-500">当前没有待审核的投稿。</p>
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
                  {submission.submittedAt
                    ? new Date(submission.submittedAt).toLocaleString('zh-CN')
                    : '未提交'}
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
    </div>
  )
}
