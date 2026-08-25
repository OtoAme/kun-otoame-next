'use client'

import { KunDualEditorProvider } from '~/components/kun/milkdown/DualEditorProvider'
import { markdownToText } from '~/utils/markdownToText'
import type { PatchSubmissionPayload } from '~/types/api/patchSubmission'

interface Props {
  payload: PatchSubmissionPayload
  editable: boolean
  onChange: (payload: PatchSubmissionPayload) => void
}

export const SubmissionIntroduction = ({
  payload,
  editable,
  onChange
}: Props) => (
  <div className="space-y-2">
    <h2 className="text-xl">游戏介绍 (必须)</h2>
    <p className="text-sm text-default-500">
      游戏介绍会进入详情页与搜索摘要，建议填写 100 字以上。
    </p>
    {editable ? (
      <KunDualEditorProvider
        value={payload.introduction}
        onChange={(introduction) => onChange({ ...payload, introduction })}
      />
    ) : (
      <div className="whitespace-pre-wrap rounded-lg bg-content2 p-4 text-sm">
        {payload.introduction}
      </div>
    )}
    <p className="text-sm text-default-500">
      字数: {markdownToText(payload.introduction).length}
    </p>
  </div>
)
