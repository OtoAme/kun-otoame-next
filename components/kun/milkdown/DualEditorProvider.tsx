'use client'

import { useCallback, useState } from 'react'
import dynamic from 'next/dynamic'
import { Tab, Tabs } from '@heroui/tabs'
import { Code, Edit } from 'lucide-react'
import { KunEditor } from './Editor'
import { KunLoading } from '~/components/kun/Loading'

const Codemirror = dynamic(
  () => import('./codemirror/Codemirror').then((mod) => mod.Codemirror),
  {
    ssr: false,
    loading: () => <KunLoading className="min-h-48" hint="正在加载编辑器" />
  }
)

interface Props {
  value: string
  onChange: (value: string) => void
}

export const KunDualEditorProvider = ({ value, onChange }: Props) => {
  const [cmAPI, setCmAPI] = useState({
    update: (_: string) => {}
  })

  const saveMarkdown = useCallback(
    (markdown: string) => {
      onChange(markdown)
      cmAPI.update(markdown)
    },
    [cmAPI, onChange]
  )

  const onCodemirrorChange = useCallback(
    (getCode: () => string) => {
      onChange(getCode())
    },
    [onChange]
  )

  return (
    <Tabs aria-label="Editor options" size="lg" variant="underlined">
      <Tab
        key="code"
        title={
          <div className="flex items-center gap-2">
            <Code size={18} />
            <span>代码编辑</span>
          </div>
        }
      >
        <Codemirror
          markdown={value}
          setCmAPI={setCmAPI}
          onChange={onCodemirrorChange}
        />
      </Tab>

      <Tab
        key="editor"
        title={
          <div className="flex items-center gap-2">
            <Edit size={18} />
            <span>编辑预览</span>
          </div>
        }
      >
        <KunEditor valueMarkdown={value} saveMarkdown={saveMarkdown} />
      </Tab>
    </Tabs>
  )
}
