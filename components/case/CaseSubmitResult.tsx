'use client'

import Link from 'next/link'
import { Button } from '@heroui/react'
import { CircleCheck } from 'lucide-react'
import type { CaseCreateResponse } from '~/types/api/case'

interface Props {
  result: CaseCreateResponse
  /** Who handles it and when to expect a first reply, e.g.「资源发布者，预计 7 天内首次回应」. */
  handler: string
}

/**
 * What replaced the vanishing success toast (D22): where the report went,
 * and a direct way to follow it.
 */
export const CaseSubmitResult = ({ result, handler }: Props) => {
  const count = result.case.subscriberCount
  // 私有事项（举报、条目页反馈）登记关注时不透露别人也报告过（D4）
  const title = result.created
    ? '已提交'
    : !result.subscribed
      ? '已补充到你之前的提交'
      : result.case.public
        ? '已为你登记关注'
        : '已提交'
  const detail = result.created
    ? `已交给${handler}。处理进度会通过站内通知告诉你。`
    : !result.subscribed
      ? '你之前提交的同一问题还在处理中，这次写的说明已附在里面。'
      : result.case.public
        ? `相同问题正在处理中${
            count ? `，已有 ${count} 人报告` : ''
          }；你写的说明已附在这条问题里，结案时会通知你。`
        : `已交给${handler}，结案时会通知你。`
  return (
    <div className="space-y-3">
      <p className="flex items-center gap-2 font-medium">
        <CircleCheck className="size-5 text-success" aria-hidden />
        {title}
      </p>
      <p className="text-sm text-default-500">{detail}</p>
      <Button
        as={Link}
        href={`/issue/${result.case.id}`}
        color="primary"
        variant="flat"
      >
        查看这条问题
      </Button>
    </div>
  )
}
