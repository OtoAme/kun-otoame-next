'use client'

import { useState } from 'react'
import { Button } from '~/components/dashboard/ui/button'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle
} from '~/components/dashboard/ui/sheet'
import { MERGE_BATCH_MAX } from '~/types/api/officialMirror'
import { ConfirmActionDialog } from '../ConfirmActionDialog'
import { batchLineStatusText } from '../mergeConfirmation'
import { batchRunConsequence, cardName, sectionLabel } from './mergeDisplay'
import type { BatchRunLine, MergeBatchList } from './useMergeBatchList'

function ResultLine({
  line,
  onRetry
}: {
  line: BatchRunLine
  onRetry: (key: string) => void
}) {
  const cache = line.cache
  return (
    <li className="flex min-w-0 flex-col gap-1 rounded-md border p-2 text-sm">
      <p className="break-words">
        {cardName(line.userName)} ← {cardName(line.staffName)}
      </p>
      <p className="text-xs text-muted-foreground tabular-nums">
        #{line.userResourceId} ← #{line.staffResourceId}
      </p>
      <p className="break-words">{batchLineStatusText(line)}</p>
      {line.status === 'merged' && cache ? (
        cache.cacheRefreshed ? (
          <p className="text-muted-foreground">页面缓存已刷新。</p>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <p>页面缓存没有刷新。</p>
            {cache.retry ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={cache.pending}
                aria-label={`仅刷新缓存 #${line.userResourceId} ← #${line.staffResourceId}`}
                onClick={() => onRetry(line.key)}
              >
                {cache.pending ? '正在刷新缓存…' : '仅刷新缓存'}
              </Button>
            ) : (
              <p className="text-muted-foreground">
                没有可用的页面标识，不能刷新缓存。
              </p>
            )}
          </div>
        )
      ) : null}
      {cache?.error ? (
        <p role="alert" className="break-words text-destructive">
          {cache.error}
        </p>
      ) : null}
    </li>
  )
}

/** 批量合并清单: confirmed high pairs, the run, and the last results. */
export function BatchListSheet({
  open,
  onOpenChange,
  batch
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  batch: MergeBatchList
}) {
  const [confirm, setConfirm] = useState(false)
  const count = batch.items.length
  const overLimit = count > MERGE_BATCH_MAX

  return (
    <>
      <Sheet
        open={open}
        onOpenChange={(next) => {
          if (!next && batch.pending) return
          onOpenChange(next)
        }}
      >
        <SheetContent side="right" className="w-full gap-0 sm:max-w-md">
          <SheetHeader className="border-b">
            <SheetTitle>批量合并清单</SheetTitle>
            <SheetDescription>
              {count} 对 · 仅限高置信配对 · 每批最多 {MERGE_BATCH_MAX} 对
            </SheetDescription>
          </SheetHeader>
          <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
            {count > 0 ? (
              <ul aria-label="清单中的配对" className="flex flex-col gap-2">
                {batch.items.map((item) => (
                  <li
                    key={`${item.userResourceId}:${item.staffResourceId}`}
                    className="flex min-w-0 items-start gap-2 rounded-md border p-2 text-sm"
                  >
                    <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <p className="font-medium break-words">
                        {cardName(item.userName)}
                      </p>
                      <p className="break-words">
                        ← {cardName(item.staffName)}
                      </p>
                      <p className="text-xs break-words text-muted-foreground">
                        #{item.userResourceId} ← #{item.staffResourceId} ·{' '}
                        {item.patchName || '—'} · {sectionLabel(item.section)}
                      </p>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={batch.pending}
                      aria-label={`移除 #${item.userResourceId} ← #${item.staffResourceId}`}
                      onClick={() =>
                        batch.remove(item.userResourceId, item.staffResourceId)
                      }
                    >
                      移除
                    </Button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">清单为空。</p>
            )}
            {batch.error && !confirm ? (
              <p role="alert" className="text-sm break-words text-destructive">
                {batch.error}
              </p>
            ) : null}
            {batch.run ? (
              <section aria-label="上次结果" className="flex flex-col gap-2">
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-medium">上次结果</h3>
                  <span className="flex-1" />
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={batch.closeRun}
                  >
                    关闭结果
                  </Button>
                </div>
                <ul className="flex flex-col gap-2">
                  {batch.run.lines.map((line) => (
                    <ResultLine
                      key={line.key}
                      line={line}
                      onRetry={batch.retryCache}
                    />
                  ))}
                </ul>
              </section>
            ) : null}
          </div>
          <SheetFooter className="flex-row flex-wrap justify-end border-t">
            <Button
              type="button"
              variant="outline"
              disabled={count === 0 || batch.pending}
              onClick={batch.clear}
            >
              清空清单
            </Button>
            <Button
              type="button"
              disabled={count === 0 || overLimit || batch.pending}
              onClick={() => {
                batch.clearError()
                setConfirm(true)
              }}
            >
              {batch.pending ? '正在合并…' : `合并 ${count} 对`}
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
      <ConfirmActionDialog
        open={confirm}
        title={`合并 ${count} 对`}
        consequence={batchRunConsequence(count)}
        confirmLabel="合并"
        pending={batch.pending}
        error={batch.error}
        onOpenChange={(next) => {
          if (!next && !batch.pending) {
            setConfirm(false)
            batch.clearError()
          }
        }}
        onConfirm={() => {
          void batch.start().then((done) => {
            if (done) setConfirm(false)
          })
        }}
      />
    </>
  )
}
