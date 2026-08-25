'use client'

import { Switch } from '@heroui/react'
import { GALGAME_AGE_LIMIT_MAP } from '~/constants/galgame'
import type { PatchSubmissionPayload } from '~/types/api/patchSubmission'

interface Props {
  payload: PatchSubmissionPayload
  editable: boolean
  onChange: (payload: PatchSubmissionPayload) => void
}

export const SubmissionContentLimit = ({
  payload,
  editable,
  onChange
}: Props) => (
  <div className="space-y-2">
    <h2 className="text-xl">文章内容分级</h2>
    <Switch
      color="danger"
      size="lg"
      isDisabled={!editable}
      isSelected={payload.contentLimit === 'nsfw'}
      onValueChange={(isNSFW) =>
        onChange({ ...payload, contentLimit: isNSFW ? 'nsfw' : 'sfw' })
      }
    >
      {GALGAME_AGE_LIMIT_MAP[payload.contentLimit]}
    </Switch>
  </div>
)
