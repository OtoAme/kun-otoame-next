'use client'

import { useEffect, useId, useState, type RefObject } from 'react'
import { ChevronRight, TriangleAlert } from 'lucide-react'
import { Collapsible } from 'radix-ui'
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from '~/components/dashboard/ui/alert-dialog'
import { Badge } from '~/components/dashboard/ui/badge'
import { Button } from '~/components/dashboard/ui/button'
import { Checkbox } from '~/components/dashboard/ui/checkbox'
import { Label } from '~/components/dashboard/ui/label'
import {
  SUPPORTED_LANGUAGE_MAP,
  SUPPORTED_PLATFORM_MAP,
  SUPPORTED_TYPE_MAP
} from '~/constants/resource'
import type { MergePreview } from '~/types/api/officialMirror'
import {
  cardName,
  linkStorageLabel,
  mergeOutcome,
  PAIR_CLASS_LABEL,
  sectionLabel,
  showTime
} from './mergeDisplay'

const ATTRIBUTE_LABELS: Record<string, Record<string, string>> = {
  类型: SUPPORTED_TYPE_MAP,
  语言: SUPPORTED_LANGUAGE_MAP,
  平台: SUPPORTED_PLATFORM_MAP
}

const fieldValue = (
  preview: MergePreview,
  field: string,
  side: 'user' | 'staff'
) => preview.fieldComparison.find((item) => item.field === field)?.[side] ?? ''

const showAttribute = (field: string, value: string) =>
  value
    ? value
        .split('、')
        .map((item) => ATTRIBUTE_LABELS[field]?.[item] ?? item)
        .join('、')
    : '未提供'

// Compare declared text only: different labels do not establish different files.
const declaredSizes = (preview: MergePreview, side: 'user' | 'staff') => {
  const links = preview.linkSummary[side]
  if (!links.length || links.some((link) => !link.size.trim())) return null
  return [
    ...new Set(links.map((link) => link.size.replace(/\s+/g, '').toLowerCase()))
  ]
    .sort()
    .join('、')
}

function Difference() {
  return (
    <span className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-amber-700 dark:text-amber-400">
      <TriangleAlert className="size-3" aria-hidden="true" />
      不同
    </span>
  )
}

function ResourceNote({ note }: { note: string }) {
  const [expanded, setExpanded] = useState(false)
  if (!note.trim())
    return <p className="text-sm text-muted-foreground">未填写备注</p>
  if (note.length <= 120) {
    return <p className="text-sm whitespace-pre-wrap break-all">{note}</p>
  }
  return (
    <Collapsible.Root
      open={expanded}
      onOpenChange={setExpanded}
      className="group/note space-y-2"
    >
      {!expanded ? (
        <p className="text-sm whitespace-pre-wrap break-all">
          {note.slice(0, 120)}…
        </p>
      ) : null}
      <Collapsible.Content className="text-sm whitespace-pre-wrap break-all">
        {note}
      </Collapsible.Content>
      <Collapsible.Trigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-auto px-0 py-1"
        >
          <ChevronRight
            className="size-4 transition-transform group-data-[state=open]/note:rotate-90 motion-reduce:transition-none"
            aria-hidden="true"
          />
          {expanded ? '收起备注' : '查看完整备注'}
        </Button>
      </Collapsible.Trigger>
    </Collapsible.Root>
  )
}

function ResourceComparison({
  preview,
  side,
  sizesDiffer,
  adding
}: {
  preview: MergePreview
  side: 'user' | 'staff'
  sizesDiffer: boolean
  adding: boolean
}) {
  const card = preview[side]
  const user = side === 'user'
  const links = preview.linkSummary[side]
  const identity = user ? '社区资源' : '官方资源'
  const treatment = user ? '保留' : '并入后删除'
  const note = fieldValue(preview, '备注', side)
  return (
    <section
      aria-label={`${identity} #${card.id}`}
      className="min-w-0 space-y-4 rounded-lg border p-4"
    >
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={user ? 'secondary' : 'outline'}>{identity}</Badge>
          <span
            className={
              user
                ? 'text-sm font-medium'
                : 'text-sm font-medium text-destructive'
            }
          >
            {adding ? '执行时' : ''}
            {treatment}
          </span>
          <span className="ml-auto text-sm text-muted-foreground">
            #{card.id}
          </span>
        </div>
        <h3 className="font-semibold break-all">{cardName(card.name)}</h3>
      </div>
      <dl className="space-y-2 text-sm">
        <div className="grid grid-cols-[4.5rem_minmax(0,1fr)] gap-2">
          <dt className="text-muted-foreground">发布者</dt>
          <dd className="break-all">{card.publisher?.name || '未提供'}</dd>
        </div>
        <div className="grid grid-cols-[4.5rem_minmax(0,1fr)] gap-2">
          <dt className="text-muted-foreground">发布时间</dt>
          <dd className="break-words">{showTime(card.created)}</dd>
        </div>
        {['类型', '语言', '平台', '状态'].map((field) => {
          const value = fieldValue(preview, field, side)
          const different =
            fieldValue(preview, field, 'user') !==
            fieldValue(preview, field, 'staff')
          return (
            <div
              key={field}
              className="grid grid-cols-[4.5rem_minmax(0,1fr)] gap-2"
              data-different={different}
            >
              <dt className="text-muted-foreground">{field}</dt>
              <dd className="flex min-w-0 flex-wrap items-start gap-x-2 gap-y-1">
                <span className="min-w-0 break-all">
                  {showAttribute(field, value)}
                </span>
                {different ? <Difference /> : null}
              </dd>
            </div>
          )
        })}
        <div className="grid grid-cols-[4.5rem_minmax(0,1fr)] gap-2">
          <dt className="text-muted-foreground">获取次数</dt>
          <dd className="tabular-nums">{card.download}</dd>
        </div>
      </dl>
      <div className="space-y-2 border-t pt-3">
        <div className="flex flex-wrap items-center gap-2 text-sm font-medium">
          链接（{links.length} 条）
          {preview.linkSummary.user.length !==
          preview.linkSummary.staff.length ? (
            <Difference />
          ) : null}
        </div>
        <ul className="space-y-2 text-sm">
          {links.map((link) => (
            <li key={link.id} className="space-y-1 rounded-md bg-muted/50 p-2">
              <p className="break-all text-muted-foreground">
                {linkStorageLabel(link.storage)} · 链接 #{link.id}
              </p>
              <p className="flex flex-wrap items-center gap-2 break-all">
                <span>声明大小：{link.size.trim() || '未填写'}</span>
                {sizesDiffer ? <Difference /> : null}
              </p>
            </li>
          ))}
        </ul>
        {!links.length ? (
          <p className="text-sm text-muted-foreground">没有链接</p>
        ) : null}
      </div>
      <div className="space-y-2 border-t pt-3">
        <p className="text-sm font-medium">备注</p>
        <ResourceNote note={note} />
      </div>
    </section>
  )
}

export function MergeConfirmDialog({
  open,
  preview,
  mode,
  pending,
  error,
  returnFocusRef,
  onOpenChange,
  onConfirm
}: {
  open: boolean
  preview: MergePreview
  mode: 'merge' | 'add'
  pending: boolean
  error?: string
  returnFocusRef?: RefObject<HTMLButtonElement | null>
  onOpenChange: (open: boolean) => void
  onConfirm: () => void
}) {
  const checkboxId = useId()
  const [checked, setChecked] = useState(false)
  useEffect(() => {
    setChecked(false)
  }, [open, mode, preview.basis, preview.user.id, preview.staff.id])
  const adding = mode === 'add'
  const outcome = mergeOutcome(preview)
  const userSizes = declaredSizes(preview, 'user')
  const staffSizes = declaredSizes(preview, 'staff')
  const sizesDiffer =
    userSizes !== null && staffSizes !== null && userSizes !== staffSizes
  const blocked = pending || !checked || !preview.canMerge

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (!next && pending) return
        onOpenChange(next)
      }}
    >
      <AlertDialogContent
        className="flex max-h-[calc(100dvh-2rem)] min-h-0 flex-col gap-0 overflow-hidden p-0 data-[size=default]:sm:max-w-4xl"
        onCloseAutoFocus={(event) => {
          const trigger = returnFocusRef?.current
          if (trigger?.isConnected) {
            event.preventDefault()
            trigger.focus()
          }
        }}
      >
        <AlertDialogHeader className="shrink-0 place-items-start border-b p-4 text-left sm:px-6">
          <AlertDialogTitle>
            {adding ? '核对并加入批量合并清单' : '确认合并资源'}
          </AlertDialogTitle>
          <AlertDialogDescription className="break-words">
            {adding ? '此操作仅加入清单，尚不执行合并。清单执行时，' : ''}
            将官方资源{' '}
            <strong className="text-foreground">
              #{preview.staff.id}
            </strong>{' '}
            并入社区资源{' '}
            <strong className="text-foreground">#{preview.user.id}</strong>
            ，社区卡片保留，官方卡片在链接移入后删除。
          </AlertDialogDescription>
          <p className="text-sm break-all text-muted-foreground">
            {preview.user.patchName || '未提供游戏名称'} ·{' '}
            {sectionLabel(preview.user.section)}
          </p>
          {preview.staffLikeCount > 0 ? (
            <p className="flex items-start gap-2 text-sm font-medium text-destructive">
              <TriangleAlert
                className="mt-0.5 size-4 shrink-0"
                aria-hidden="true"
              />
              执行合并后，官方资源的 {preview.staffLikeCount} 个点赞不迁移。
            </p>
          ) : null}
        </AlertDialogHeader>

        <div
          className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain p-4 sm:px-6"
          aria-label="资源核对内容"
          tabIndex={0}
        >
          <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <Badge variant="outline">
              {PAIR_CLASS_LABEL[preview.classification]}
            </Badge>
            <p>匹配结果仅供参考，不能证明文件或版本相同。</p>
          </div>
          {sizesDiffer ? (
            <p className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/5 p-3 text-sm text-amber-800 dark:text-amber-300">
              <TriangleAlert
                className="mt-0.5 size-4 shrink-0"
                aria-hidden="true"
              />
              两侧填写的大小不同，请结合版本、安装形式和备注进一步核对内容。
            </p>
          ) : null}
          <div className="grid min-w-0 gap-4 md:grid-cols-2">
            <ResourceComparison
              preview={preview}
              side="user"
              sizesDiffer={sizesDiffer}
              adding={adding}
            />
            <ResourceComparison
              preview={preview}
              side="staff"
              sizesDiffer={sizesDiffer}
              adding={adding}
            />
          </div>
          <section
            aria-label="执行合并后的结果"
            className="space-y-2 rounded-lg border p-4 text-sm"
          >
            <h3 className="font-semibold">执行合并后的结果</h3>
            <ul className="list-disc space-y-1.5 pl-4 text-muted-foreground">
              {[
                outcome.kept,
                outcome.composition,
                outcome.note,
                outcome.download
              ].map((line) => (
                <li key={line} className="break-words">
                  {line}
                </li>
              ))}
            </ul>
            {outcome.backupWarning ? (
              <p className="font-medium">{outcome.backupWarning}</p>
            ) : null}
          </section>
          <section
            aria-label="删除与点赞处理"
            className="space-y-2 rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm"
          >
            <h3 className="flex items-center gap-2 font-semibold text-destructive">
              <TriangleAlert className="size-4 shrink-0" aria-hidden="true" />
              {adding ? '执行合并时的删除与点赞处理' : '删除与点赞处理'}
            </h3>
            <p className="break-all">{outcome.deletion}</p>
            {outcome.likes ? (
              <p
                className={
                  preview.staffLikeCount > 0
                    ? 'font-medium text-destructive'
                    : 'text-muted-foreground'
                }
              >
                {outcome.likes}
              </p>
            ) : null}
          </section>
          {preview.exitedPairs.length ? (
            <Collapsible.Root className="group/exited rounded-lg border p-4 text-sm">
              <Collapsible.Trigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  className="h-auto w-full justify-start px-0 py-0 text-left whitespace-normal"
                >
                  <ChevronRight
                    className="size-4 shrink-0 transition-transform group-data-[state=open]/exited:rotate-90 motion-reduce:transition-none"
                    aria-hidden="true"
                  />
                  其他受影响的配对（{preview.exitedPairs.length}）
                </Button>
              </Collapsible.Trigger>
              <p className="mt-2 break-words text-muted-foreground">
                执行合并后，下列官方资源退出与社区资源 #{preview.user.id}{' '}
                的候选配对，资源卡片仍然保留。
              </p>
              <Collapsible.Content>
                <ul className="mt-3 space-y-2">
                  {preview.exitedPairs.map((pair) => (
                    <li
                      key={pair.staffResourceId}
                      className="rounded-md bg-muted/50 p-2 break-all"
                    >
                      官方资源 #{pair.staffResourceId}{' '}
                      {cardName(pair.staffName)} · 卡片保留
                    </li>
                  ))}
                </ul>
              </Collapsible.Content>
            </Collapsible.Root>
          ) : null}
        </div>

        <div className="shrink-0 space-y-3 border-t bg-background p-4 sm:px-6">
          <div className="flex items-start gap-2">
            <Checkbox
              id={checkboxId}
              checked={checked}
              disabled={pending}
              onCheckedChange={(value) => setChecked(value === true)}
            />
            <Label htmlFor={checkboxId} className="leading-5">
              已核实两张卡片为同一份内容
            </Label>
          </div>
          {error ? (
            <p role="alert" className="break-all text-sm text-destructive">
              {error}
            </p>
          ) : null}
          {!preview.canMerge ? (
            <p role="alert" className="text-sm text-destructive">
              这一对当前不能合并，请关闭后刷新核对。
            </p>
          ) : null}
          <AlertDialogFooter className="flex-row">
            <AlertDialogCancel disabled={pending}>取消</AlertDialogCancel>
            <Button
              type="button"
              variant={adding ? 'default' : 'destructive'}
              disabled={blocked}
              onClick={() => {
                if (!blocked) onConfirm()
              }}
            >
              {pending
                ? '正在提交…'
                : adding
                  ? '加入清单'
                  : `确认合并到 #${preview.user.id}`}
            </Button>
          </AlertDialogFooter>
        </div>
      </AlertDialogContent>
    </AlertDialog>
  )
}
