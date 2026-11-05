'use client'

import { Badge } from '~/components/dashboard/ui/badge'
import type { MergePreview } from '~/types/api/officialMirror'
import { linkStorageLabel, mergeOutcome } from './mergeDisplay'

/** 合并此配对的结果. Every line is read from the preview of the pair. */
export function MergeOutcomePanel({
  preview,
  loading,
  error,
  emptyText
}: {
  preview: MergePreview | null
  loading: boolean
  error: string
  /** Shown when there is no preview to describe. */
  emptyText: string | null
}) {
  const outcome = preview ? mergeOutcome(preview) : null
  return (
    <section
      aria-label="合并此配对的结果"
      className="flex min-w-0 flex-col gap-2 rounded-lg border p-3 text-sm"
    >
      <h4 className="font-medium">合并此配对的结果</h4>
      {loading && !preview ? (
        <p className="text-muted-foreground">正在读取合并预览…</p>
      ) : null}
      {error ? (
        <p role="alert" className="break-words text-destructive">
          {error}
        </p>
      ) : null}
      {!preview && !loading && !error && emptyText ? (
        <p className="text-muted-foreground">{emptyText}</p>
      ) : null}
      {preview && outcome ? (
        <>
          {!preview.canMerge ? (
            <div className="flex flex-col gap-1">
              <p className="font-medium">当前不能合并</p>
              <ul className="flex flex-col gap-1">
                {preview.blocks.map((block) => (
                  <li key={block.code} role="status" className="break-words">
                    {block.message}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {outcome.backupWarning ? (
            <p
              role="status"
              className="rounded-md border border-amber-500/40 bg-amber-500/10 px-2 py-1.5 break-words"
            >
              {outcome.backupWarning}
            </p>
          ) : null}
          <ul className="flex flex-col gap-1.5">
            <li className="break-words">{outcome.deletion}</li>
            <li className="break-words">{outcome.kept}</li>
            <li className="break-words text-muted-foreground">
              {outcome.attributes.join('；')}
            </li>
            <li className="break-words">{outcome.composition}</li>
            <li className="break-words">{outcome.note}</li>
            <li className="break-words">{outcome.download}</li>
            {outcome.likes ? (
              <li className="break-words">{outcome.likes}</li>
            ) : null}
            {outcome.exited.map((line) => (
              <li key={line} className="break-words">
                {line}
              </li>
            ))}
          </ul>
          {outcome.links.length > 0 ? (
            <ol aria-label="合并后的链接" className="flex flex-col gap-1.5">
              {outcome.links.map((link) => (
                <li key={link.id} className="min-w-0 rounded-md border p-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span>{linkStorageLabel(link.storage)}</span>
                    <span className="text-muted-foreground">
                      {link.size || '无大小'}
                    </span>
                    {link.storage === 'touchgal' ? (
                      <Badge variant="outline">站方备份</Badge>
                    ) : null}
                  </div>
                  {link.content ? (
                    <p className="mt-1 font-mono text-xs break-all">
                      {link.content}
                    </p>
                  ) : null}
                </li>
              ))}
            </ol>
          ) : null}
        </>
      ) : null}
    </section>
  )
}
