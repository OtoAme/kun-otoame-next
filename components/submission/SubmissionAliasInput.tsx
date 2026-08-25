'use client'

import { useState } from 'react'
import { Button, Input } from '@heroui/react'
import { Plus } from 'lucide-react'
import toast from 'react-hot-toast'
import { SortableAliasChips } from '~/components/edit/components/SortableAliasChips'
import type { PatchSubmissionPayload } from '~/types/api/patchSubmission'

interface Props {
  payload: PatchSubmissionPayload
  editable: boolean
  onChange: (payload: PatchSubmissionPayload) => void
}

export const SubmissionAliasInput = ({
  payload,
  editable,
  onChange
}: Props) => {
  const [newAlias, setNewAlias] = useState('')

  const addAlias = () => {
    const alias = newAlias.trim()
    if (!alias) return
    if (payload.alias.includes(alias)) {
      toast.error('请不要使用重复的别名')
      return
    }
    onChange({ ...payload, alias: [...payload.alias, alias] })
    setNewAlias('')
  }

  return (
    <div className="space-y-2">
      <h2 className="text-xl">游戏别名 (可选)</h2>
      <div className="flex gap-2">
        <Input
          placeholder="输入后点击加号添加"
          value={newAlias}
          isReadOnly={!editable}
          onValueChange={setNewAlias}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              addAlias()
            }
          }}
        />
        <Button
          isIconOnly
          color="primary"
          aria-label="添加 OtomeGame 别名"
          isDisabled={!editable}
          onPress={addAlias}
        >
          <Plus className="size-5" />
        </Button>
      </div>
      <p className="text-sm text-default-500">
        建议把游戏日语原名放在第一个别名，便于搜索与生成 SEO 信息。
      </p>
      <SortableAliasChips
        values={payload.alias}
        onReorder={(alias) => editable && onChange({ ...payload, alias })}
        onRemove={(index) =>
          editable &&
          onChange({
            ...payload,
            alias: payload.alias.filter((_, at) => at !== index)
          })
        }
      />
    </div>
  )
}
