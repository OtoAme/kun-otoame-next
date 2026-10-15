'use client'

import { useState } from 'react'
import {
  Button,
  Card,
  CardBody,
  Checkbox,
  Radio,
  RadioGroup
} from '@heroui/react'
import toast from 'react-hot-toast'
import { kunFetchPost } from '~/utils/kunFetch'
import { useUserStore } from '~/store/userStore'
import { LINK_REPORT_REASONS } from '~/constants/linkHealth'
import {
  buildLinkTarget,
  linkReportOutcomeText,
  LINK_REPORT_REASON_HINTS,
  LINK_REPORT_REASON_LABELS
} from './linkHealthDisplay'
import type { PatchResourceLink } from '~/types/api/patch'
import type {
  LinkHealthMutationResponse,
  LinkReportReason,
  LinkReportResponse
} from '~/types/api/linkHealth'

interface Props {
  patchId: number
  resourceId: number
  link: PatchResourceLink
  /** Fixed when the caller already picked the phenomenon (05 two-step). */
  reason?: LinkReportReason
  onCancel: () => void
  /** Parent opens its own login prompt after the dialog closes. */
  onLoginRequired: () => void
  onReported?: (view: LinkHealthMutationResponse['link']) => void
}

const WEAK_REASON: LinkReportReason = 'unreachable'

/**
 * Shared failure-report vote (modules 04 + 05 quick entry): one weighted
 * reason, optional weak-evidence network acknowledgement. It never infers
 * eligibility — guests get the login guide and missing versions only hint a
 * refresh; the server makes every final call.
 */
export const LinkReportPanel = ({
  patchId,
  resourceId,
  link,
  reason: fixedReason,
  onCancel,
  onLoginRequired,
  onReported
}: Props) => {
  const { user } = useUserStore((state) => state)
  const [reason, setReason] = useState<LinkReportReason>(
    fixedReason ?? 'deleted'
  )
  const [networkAcknowledged, setNetworkAcknowledged] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [resultText, setResultText] = useState('')

  const guest = user.uid < 1
  const target = buildLinkTarget(patchId, resourceId, link)
  const needsAck = reason === WEAK_REASON
  const canSubmit =
    !!target && !submitting && (!needsAck || networkAcknowledged)

  const handleSubmit = async () => {
    if (guest) {
      onCancel()
      onLoginRequired()
      return
    }
    if (!target || !canSubmit) return
    setSubmitting(true)
    try {
      const res = await kunFetchPost<LinkReportResponse | string>(
        '/patch/resource/link/report',
        {
          ...target,
          reason,
          ...(needsAck ? { networkAcknowledged: true } : {})
        }
      )
      if (typeof res === 'string') {
        // Named business errors (eligibility, version conflict, duplicate
        // network ack, slow): surface verbatim, keep the user's selection.
        toast.error(res || '提交失败，请稍后重试')
        return
      }
      onReported?.(res.link)
      setResultText(linkReportOutcomeText(res.report, res.caseId))
    } catch {
      toast.error('网络错误，提交失败，请重试')
    } finally {
      setSubmitting(false)
    }
  }

  if (resultText) {
    return (
      <div className="space-y-3">
        <p className="text-sm">{resultText}</p>
        <div className="flex justify-end">
          <Button variant="light" onPress={onCancel}>
            关闭
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {!target && (
        <p className="text-sm text-default-500">
          页面数据不是最新版本，请刷新页面后再报告。
        </p>
      )}

      {fixedReason === undefined ? (
        <RadioGroup
          aria-label="失效原因"
          label="这条链接出现了什么问题？"
          value={reason}
          onValueChange={(value) => setReason(value as LinkReportReason)}
        >
          {LINK_REPORT_REASONS.map((value) => (
            <Radio
              key={value}
              value={value}
              description={LINK_REPORT_REASON_HINTS[value]}
            >
              {LINK_REPORT_REASON_LABELS[value]}
            </Radio>
          ))}
        </RadioGroup>
      ) : (
        <p className="text-sm text-default-500">
          {LINK_REPORT_REASON_HINTS[reason]}
        </p>
      )}

      {needsAck && (
        <Card shadow="none" className="bg-default-100">
          <CardBody className="gap-2 p-3 text-sm">
            <p>
              打不开或超时可能和你的网络环境有关，请先尝试更换网络或使用加速器；
              只有确认之后这次报告才会被计入。
            </p>
            <Checkbox
              isSelected={networkAcknowledged}
              onValueChange={setNetworkAcknowledged}
            >
              我已尝试更换网络或加速器
            </Checkbox>
          </CardBody>
        </Card>
      )}

      {guest && (
        <p className="text-sm text-default-500">提交需要先登录账号。</p>
      )}

      <div className="flex justify-end gap-2">
        <Button variant="light" onPress={onCancel} isDisabled={submitting}>
          取消
        </Button>
        <Button
          color="primary"
          onPress={() => void handleSubmit()}
          isDisabled={!guest && !canSubmit}
          isLoading={submitting}
        >
          {guest ? '登录后提交' : '提交'}
        </Button>
      </div>
    </div>
  )
}
