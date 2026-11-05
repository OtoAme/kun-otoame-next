'use client'

import { useEffect, useRef, useState } from 'react'
import { ChevronRight, ExternalLink } from 'lucide-react'
import { Collapsible } from 'radix-ui'
import { PreviewFrame } from '~/components/dashboard/inbox/PreviewFrame'
import { Badge } from '~/components/dashboard/ui/badge'
import { Button } from '~/components/dashboard/ui/button'
import { Skeleton } from '~/components/dashboard/ui/skeleton'
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger
} from '~/components/dashboard/ui/tabs'
import { kunFetchGet, kunFetchPost } from '~/utils/kunFetch'
import type {
  MergeOption,
  MergeOptionsResponse,
  MergePreview,
  MergeResult,
  MergeTab
} from '~/types/api/officialMirror'
import {
  MERGE_BATCH_MAX,
  MERGE_DISMISS_CARD_MAX
} from '~/types/api/officialMirror'
import { ConfirmActionDialog } from '../ConfirmActionDialog'
import { cacheRefreshBody, type CacheRefreshRequest } from '../cacheRefresh'
import {
  acceptDismissCardResult,
  acceptMergeOptions,
  acceptMergePreview,
  isBackupBasis,
  notifyOfficialMirrorQueue,
  shouldApplyPreview
} from '../contract'
import { confirmPairContent } from '../mergeConfirmation'
import { MergeOptionCard } from './MergeOptionCard'
import { MergeOutcomePanel } from './MergeOutcomePanel'
import {
  cardName,
  cardPageHref,
  defaultStaffId,
  dismissableIds,
  dismissCardConsequence,
  dismissConsequence,
  groupOptions,
  mergeConsequence,
  reopenConsequence,
  sectionLabel,
  showTime,
  survivorSrc,
  userCardSrc
} from './mergeDisplay'
import type { MergeBatchList } from './useMergeBatchList'

export type SingleMergeOutcome = {
  userResourceId: number
  staffResourceId: number
  userName: string
  staffName: string
  cacheRefreshed: boolean
  retry: CacheRefreshRequest | null
}

type DialogState =
  | { kind: 'merge'; preview: MergePreview }
  | { kind: 'add'; preview: MergePreview }
  | { kind: 'dismiss'; staffResourceId: number }
  | { kind: 'reopen'; staffResourceId: number }
  | { kind: 'dismissCard'; staffResourceIds: number[] }

type PreviewState = {
  staffResourceId: number
  data: MergePreview | null
  error: string
  loading: boolean
}

const UNKNOWN_WRITE = '没有确认这次操作是否已经写入，请刷新核对后再操作'
const NETWORK_ERROR = '网络错误，请稍后重试'
const CONFIRM_LABEL = '已核实两张卡片为同一份内容'

function OptionGroup({
  title,
  options,
  currentId,
  readOnly,
  selectable,
  onSelect
}: {
  title: string
  options: MergeOption[]
  currentId: number | null
  readOnly: boolean
  selectable: boolean
  onSelect: (id: number) => void
}) {
  return (
    <section aria-label={title} className="flex min-w-0 flex-col gap-2">
      <h4 className="text-sm font-medium text-muted-foreground">
        {title}（{options.length}）
      </h4>
      {options.map((option) => (
        <MergeOptionCard
          key={option.staff.id}
          option={option}
          current={option.staff.id === currentId}
          readOnly={readOnly}
          selectable={selectable}
          onSelect={onSelect}
        />
      ))}
    </section>
  )
}

/**
 * One user card and every staff card of its game, loaded by id through the
 * options endpoint. Keyed by the user card id: nothing here outlives the
 * selection, and responses that arrive after it changed are dropped.
 */
export function MergeWorkbench({
  userResourceId,
  tab,
  reloadNonce,
  batch,
  onMerged,
  onHandled
}: {
  userResourceId: number
  tab: MergeTab
  /** Bumped by the page after a batch run to reload this card. */
  reloadNonce: number
  batch: Pick<MergeBatchList, 'has' | 'add' | 'remove' | 'removeUser'>
  onMerged: (outcome: SingleMergeOutcome) => void
  /** A dismissal or reopen was written; `advance` opens the next row. */
  onHandled: (result: { userResourceId: number; advance: boolean }) => void
}) {
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  const [options, setOptions] = useState<MergeOptionsResponse | null>(null)
  const [optionsVersion, setOptionsVersion] = useState(0)
  const [optionsError, setOptionsError] = useState('')
  const [optionsLoading, setOptionsLoading] = useState(true)
  const [localNonce, setLocalNonce] = useState(0)
  const optionsSeq = useRef(0)

  useEffect(() => {
    const seq = optionsSeq.current + 1
    optionsSeq.current = seq
    const live = () => mounted.current && optionsSeq.current === seq
    setOptionsLoading(true)
    setOptionsError('')
    Promise.resolve()
      .then(() =>
        kunFetchGet<MergeOptionsResponse | string>(
          '/admin/resource-merges/options',
          { userResourceId }
        )
      )
      .then((body) => {
        if (!live()) return
        if (typeof body === 'string') {
          setOptionsError(body || '读取官方资源失败，请稍后重试')
          return
        }
        const accepted = acceptMergeOptions(body, userResourceId)
        if (!accepted) {
          setOptionsError('官方资源无法读取，请刷新')
          return
        }
        setOptions(accepted)
        setOptionsVersion((version) => version + 1)
      })
      .catch(() => {
        if (live()) setOptionsError(NETWORK_ERROR)
      })
      .finally(() => {
        if (live()) setOptionsLoading(false)
      })
  }, [userResourceId, reloadNonce, localNonce])

  const [chosen, setChosen] = useState<number | null>(null)
  const list = options?.options ?? []
  const readOnly = tab === 'merged'
  const defaultId = defaultStaffId(list, tab)
  const current =
    list.find((option) => option.staff.id === chosen) ??
    list.find((option) => option.staff.id === defaultId) ??
    null
  const currentId = current?.staff.id ?? null
  const previewPair =
    current && !readOnly && current.sameSection ? current.staff.id : null

  const [preview, setPreview] = useState<PreviewState | null>(null)
  const previewSeq = useRef({ seq: 0, userResourceId, staffResourceId: 0 })

  // Reloads when the pair changes and after each new options response, so
  // a refresh of the same pair keeps the old preview on screen until the
  // new one arrives instead of blanking it.
  useEffect(() => {
    if (previewPair === null) {
      previewSeq.current = {
        seq: previewSeq.current.seq + 1,
        userResourceId,
        staffResourceId: 0
      }
      setPreview(null)
      return
    }
    const request = {
      seq: previewSeq.current.seq + 1,
      userResourceId,
      staffResourceId: previewPair
    }
    previewSeq.current = request
    const live = () =>
      mounted.current && shouldApplyPreview(request, previewSeq.current)
    setPreview((prev) =>
      prev && prev.staffResourceId === previewPair
        ? { ...prev, loading: true, error: '' }
        : { staffResourceId: previewPair, data: null, error: '', loading: true }
    )
    const settle = (next: Omit<PreviewState, 'staffResourceId' | 'loading'>) =>
      setPreview({ staffResourceId: previewPair, loading: false, ...next })
    Promise.resolve()
      .then(() =>
        kunFetchGet<MergePreview | string>('/admin/resource-merges/preview', {
          userResourceId,
          staffResourceId: previewPair
        })
      )
      .then((body) => {
        if (!live()) return
        if (typeof body === 'string') {
          settle({ data: null, error: body || '读取合并预览失败，请稍后重试' })
          return
        }
        const accepted = acceptMergePreview(body, request)
        if (!accepted) {
          settle({ data: null, error: '合并预览无法读取，请刷新' })
          return
        }
        settle({ data: accepted, error: '' })
      })
      .catch(() => {
        if (live()) settle({ data: null, error: NETWORK_ERROR })
      })
  }, [userResourceId, previewPair, optionsVersion])

  const [surface, setSurface] = useState<'user' | 'survivor'>('user')
  const [blockedOpen, setBlockedOpen] = useState(false)
  useEffect(() => {
    if (current && !current.mergeable) setBlockedOpen(true)
  }, [currentId, current?.mergeable])

  const [dialog, setDialog] = useState<DialogState | null>(null)
  const [pending, setPending] = useState(false)
  const [dialogError, setDialogError] = useState('')
  const [notice, setNotice] = useState('')

  const currentPreview =
    preview && previewPair !== null && preview.staffResourceId === previewPair
      ? preview
      : null
  const previewData = currentPreview?.data ?? null
  const busy = pending || optionsLoading
  const previewReady = Boolean(
    current &&
      previewData &&
      !currentPreview?.loading &&
      previewData.staff.id === current.staff.id
  )
  const canMerge = Boolean(
    !readOnly &&
      !busy &&
      current?.mergeable &&
      previewReady &&
      previewData?.canMerge &&
      isBackupBasis(previewData.basis)
  )
  const inList = Boolean(
    current &&
      previewData &&
      batch.has(userResourceId, current.staff.id, previewData.basis)
  )
  const canAdd = Boolean(
    canMerge &&
      current?.highConfidence &&
      previewData?.classification === 'high' &&
      !inList
  )
  const dismissable = dismissableIds(list)
  const groups = groupOptions(list)
  const user = options?.user ?? null

  const reload = () => {
    setChosen(null)
    setLocalNonce((nonce) => nonce + 1)
  }

  const closeDialog = () => {
    if (pending) return
    setDialog(null)
    setDialogError('')
  }

  const rowRemains = (kind: 'dismiss' | 'reopen', staffResourceId: number) => {
    if (kind === 'dismiss') {
      if (tab !== 'pending') return true
      return list.some(
        (option) => option.staff.id !== staffResourceId && option.dismissable
      )
    }
    if (tab !== 'dismissed') return true
    return (
      list.some(
        (option) =>
          option.staff.id !== staffResourceId && option.record === 'dismissed'
      ) ||
      (options?.history ?? []).some(
        (entry) =>
          entry.status === 'dismissed' &&
          entry.staffResourceId !== staffResourceId
      )
    )
  }

  /** Builds the confirmed pair from the preview captured when the dialog opened. */
  const confirmedFrom = (snapshot: MergePreview) => {
    const pair = confirmPairContent({
      checked: true,
      canMerge: snapshot.canMerge,
      basis: snapshot.basis,
      userResourceId: snapshot.user.id,
      staffResourceId: snapshot.staff.id,
      pairClass: snapshot.classification,
      patchUniqueId: snapshot.user.patchUniqueId,
      authorId: snapshot.user.publisher.id,
      staffAuthorId: snapshot.staff.publisher.id
    })
    if (!pair) {
      setDialogError('这一对当前不能合并，请刷新后重新核对')
      return null
    }
    // A newer preview of the same pair with another basis means the cards
    // changed after the admin looked at them.
    if (
      previewData &&
      previewData.staff.id === pair.staffResourceId &&
      previewData.basis !== pair.basis
    ) {
      setDialogError('预览已变化，请关闭后重新核对')
      return null
    }
    return pair
  }

  const runMerge = async (snapshot: MergePreview) => {
    const pair = confirmedFrom(snapshot)
    if (!pair) return
    setPending(true)
    setDialogError('')
    try {
      const response = await kunFetchPost<MergeResult | string>(
        '/admin/resource-merges/merge',
        {
          userResourceId: pair.userResourceId,
          staffResourceId: pair.staffResourceId,
          basis: pair.basis,
          contentConfirmed: true
        }
      )
      if (typeof response === 'string') {
        if (mounted.current) setDialogError(response || '合并失败，请稍后重试')
        return
      }
      if (
        !response ||
        response.userResourceId !== pair.userResourceId ||
        response.staffResourceId !== pair.staffResourceId ||
        response.resourceId !== pair.userResourceId ||
        typeof response.cacheRefreshed !== 'boolean'
      ) {
        if (mounted.current) setDialogError(UNKNOWN_WRITE)
        return
      }
      notifyOfficialMirrorQueue()
      if (mounted.current) setDialog(null)
      onMerged({
        userResourceId: pair.userResourceId,
        staffResourceId: pair.staffResourceId,
        userName: cardName(snapshot.user.name),
        staffName: cardName(snapshot.staff.name),
        cacheRefreshed: response.cacheRefreshed,
        retry: response.cacheRefreshed
          ? null
          : cacheRefreshBody({
              patchUniqueId: response.patchUniqueId,
              authorIds: [pair.authorId, pair.staffAuthorId]
            })
      })
    } catch {
      if (mounted.current) setDialogError(NETWORK_ERROR)
    } finally {
      if (mounted.current) setPending(false)
    }
  }

  const addToList = (snapshot: MergePreview) => {
    const pair = confirmedFrom(snapshot)
    if (!pair) return
    if (pair.pairClass !== 'high') {
      setDialogError('只有高置信配对可以加入清单')
      return
    }
    const added = batch.add({
      ...pair,
      userName: cardName(snapshot.user.name),
      staffName: cardName(snapshot.staff.name),
      patchName: snapshot.user.patchName,
      section: snapshot.user.section
    })
    if (!added) {
      setDialogError(`清单最多 ${MERGE_BATCH_MAX} 对，请先合并或移除`)
      return
    }
    setDialog(null)
    setNotice(
      `#${pair.userResourceId} ← #${pair.staffResourceId} 已加入批量合并清单。`
    )
  }

  const runPairWrite = async (
    kind: 'dismiss' | 'reopen',
    staffResourceId: number
  ) => {
    const remains = rowRemains(kind, staffResourceId)
    setPending(true)
    setDialogError('')
    try {
      const response = await kunFetchPost<{ changed?: unknown } | string>(
        kind === 'dismiss'
          ? '/admin/resource-merges/dismiss'
          : '/admin/resource-merges/reopen',
        { userResourceId, staffResourceId }
      )
      if (typeof response === 'string') {
        if (mounted.current) setDialogError(response || '操作失败，请稍后重试')
        return
      }
      if (!response || typeof response.changed !== 'boolean') {
        if (mounted.current) setDialogError(UNKNOWN_WRITE)
        return
      }
      if (kind === 'dismiss') batch.remove(userResourceId, staffResourceId)
      notifyOfficialMirrorQueue()
      if (mounted.current) {
        setDialog(null)
        setNotice('')
        if (remains) reload()
      }
      onHandled({ userResourceId, advance: !remains })
    } catch {
      if (mounted.current) setDialogError(NETWORK_ERROR)
    } finally {
      if (mounted.current) setPending(false)
    }
  }

  const runDismissCard = async (staffResourceIds: number[]) => {
    setPending(true)
    setDialogError('')
    try {
      const response = await kunFetchPost<unknown>(
        '/admin/resource-merges/dismiss-card',
        { userResourceId, staffResourceIds }
      )
      if (typeof response === 'string') {
        if (mounted.current) setDialogError(response || '操作失败，请稍后重试')
        return
      }
      const result = acceptDismissCardResult(response)
      if (!result) {
        if (mounted.current) setDialogError(UNKNOWN_WRITE)
        return
      }
      batch.removeUser(userResourceId)
      notifyOfficialMirrorQueue()
      const remains = tab !== 'pending' || result.skipped.length > 0
      if (mounted.current) {
        setDialog(null)
        setNotice(
          result.skipped.length > 0
            ? [
                `已驳回 ${result.dismissed.length} 个配对。`,
                ...result.skipped.map(
                  (item) => `#${item.staffResourceId} 未驳回：${item.reason}`
                )
              ].join('\n')
            : ''
        )
        if (remains) reload()
      }
      onHandled({ userResourceId, advance: !remains })
    } catch {
      if (mounted.current) setDialogError(NETWORK_ERROR)
    } finally {
      if (mounted.current) setPending(false)
    }
  }

  const dialogProps = (() => {
    if (!dialog) return null
    if (dialog.kind === 'merge' || dialog.kind === 'add') {
      const snapshot = dialog.preview
      const isMerge = dialog.kind === 'merge'
      const copy = mergeConsequence(snapshot)
      return {
        title: isMerge ? '合并此配对' : '加入批量合并清单',
        consequence: copy.consequence,
        lines: copy.lines,
        confirmLabel: isMerge ? '合并' : '加入清单',
        requireConfirmation: CONFIRM_LABEL,
        tone: isMerge ? 'destructive' : 'default',
        onConfirm: () => {
          if (isMerge) void runMerge(snapshot)
          else addToList(snapshot)
        }
      } as const
    }
    if (dialog.kind === 'dismiss') {
      return {
        title: '驳回此配对',
        consequence: dismissConsequence(userResourceId, dialog.staffResourceId),
        confirmLabel: '驳回',
        tone: 'destructive',
        onConfirm: () => void runPairWrite('dismiss', dialog.staffResourceId)
      } as const
    }
    if (dialog.kind === 'reopen') {
      return {
        title: '重开此配对',
        consequence: reopenConsequence(userResourceId, dialog.staffResourceId),
        confirmLabel: '重开',
        tone: 'default',
        onConfirm: () => void runPairWrite('reopen', dialog.staffResourceId)
      } as const
    }
    return {
      title: '驳回全部配对',
      consequence: dismissCardConsequence(
        userResourceId,
        dialog.staffResourceIds.length
      ),
      confirmLabel: '驳回',
      tone: 'destructive',
      onConfirm: () => void runDismissCard(dialog.staffResourceIds)
    } as const
  })()

  const openMergeDialog = (kind: 'merge' | 'add') => {
    if (!previewData || !(kind === 'merge' ? canMerge : canAdd)) return
    setDialogError('')
    setNotice('')
    setDialog({ kind, preview: previewData })
  }

  if (!options) {
    return (
      <div className="flex h-full min-h-0 min-w-0 flex-col max-md:h-auto">
        {optionsError ? (
          <div className="flex flex-col items-center gap-3 p-6 text-center">
            <p role="alert" className="text-sm break-words text-destructive">
              {optionsError}
            </p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setLocalNonce((nonce) => nonce + 1)}
            >
              重试
            </Button>
          </div>
        ) : (
          <div
            role="status"
            aria-label="正在读取用户资源"
            className="flex flex-col gap-3 p-4"
          >
            <Skeleton className="h-5 w-2/3 animate-none" />
            <Skeleton className="h-64 w-full animate-none" />
          </div>
        )}
      </div>
    )
  }

  const href = user ? cardPageHref(user) : null
  const survivorAvailable = previewPair !== null
  const shownSurface = survivorAvailable ? surface : 'user'
  const latestMerged = options.history.find(
    (entry) => entry.status === 'merged'
  )

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col max-md:h-auto">
      <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b px-4 py-2">
        <h3 className="min-w-0 text-sm font-semibold break-words">
          用户资源 #{userResourceId} · {options.user.patchName || '—'} ·{' '}
          {sectionLabel(options.user.section)} · 社区资源
        </h3>
        {options.user.hasStaffBackup ? (
          <Badge variant="outline">已有站方备份</Badge>
        ) : null}
        <span className="flex-1" />
        {href ? (
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            在条目页查看
            <ExternalLink className="size-3.5" aria-hidden />
          </a>
        ) : null}
      </div>
      {optionsError ? (
        <div
          role="alert"
          className="flex flex-wrap items-center gap-2 border-b px-4 py-2 text-sm"
        >
          <span className="min-w-0 break-words text-destructive">
            刷新失败：{optionsError}
          </span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setLocalNonce((nonce) => nonce + 1)}
          >
            重试
          </Button>
        </div>
      ) : null}
      {notice ? (
        <p
          role="status"
          className="border-b px-4 py-2 text-sm break-words whitespace-pre-line"
        >
          {notice}
        </p>
      ) : null}

      <div className="@container min-h-0 flex-1 overflow-y-auto max-md:flex-none max-md:overflow-visible">
        <div className="grid min-w-0 gap-4 p-4 @[56rem]:grid-cols-2">
          <div className="flex min-w-0 flex-col gap-3">
            <Tabs
              value={shownSurface}
              onValueChange={(value) =>
                setSurface(value === 'survivor' ? 'survivor' : 'user')
              }
              className="min-w-0"
            >
              <TabsList aria-label="左栏预览">
                <TabsTrigger value="user">用户资源</TabsTrigger>
                <TabsTrigger value="survivor" disabled={!survivorAvailable}>
                  合并后预览
                </TabsTrigger>
              </TabsList>
              <TabsContent value="user" className="min-w-0">
                <PreviewFrame
                  src={userCardSrc(userResourceId)}
                  title={`用户资源 #${userResourceId} 预览`}
                />
              </TabsContent>
              {survivorAvailable && previewPair !== null ? (
                <TabsContent value="survivor" className="min-w-0">
                  <PreviewFrame
                    src={survivorSrc(userResourceId, previewPair)}
                    title={`合并后预览 #${userResourceId} ← #${previewPair}`}
                  />
                </TabsContent>
              ) : null}
            </Tabs>
            {readOnly ? null : (
              <MergeOutcomePanel
                preview={previewData}
                loading={Boolean(currentPreview?.loading)}
                error={currentPreview?.error ?? ''}
                emptyText={
                  current === null
                    ? '本游戏没有可以配对的官方资源。'
                    : !current.sameSection
                      ? '与用户资源不在同一分区，不能合并。'
                      : null
                }
              />
            )}
          </div>

          <div className="flex min-w-0 flex-col gap-3">
            <h4 className="text-sm font-semibold">
              本游戏的官方资源（{list.length}）
            </h4>
            {list.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                本游戏没有官方资源。
              </p>
            ) : null}
            {groups.recommended.length > 0 ? (
              <OptionGroup
                title="推荐"
                options={groups.recommended}
                currentId={currentId}
                readOnly={readOnly}
                selectable={!busy}
                onSelect={setChosen}
              />
            ) : null}
            {groups.mergeable.length > 0 ? (
              <OptionGroup
                title="其他可合并"
                options={groups.mergeable}
                currentId={currentId}
                readOnly={readOnly}
                selectable={!busy}
                onSelect={setChosen}
              />
            ) : null}
            {groups.blocked.length > 0 ? (
              <Collapsible.Root
                open={blockedOpen}
                onOpenChange={setBlockedOpen}
                className="flex min-w-0 flex-col gap-2"
              >
                <Collapsible.Trigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="w-fit px-1 text-muted-foreground"
                  >
                    <ChevronRight
                      aria-hidden
                      className={
                        blockedOpen
                          ? 'rotate-90 transition-transform motion-reduce:transition-none'
                          : 'transition-transform motion-reduce:transition-none'
                      }
                    />
                    不可合并（{groups.blocked.length}）
                  </Button>
                </Collapsible.Trigger>
                <Collapsible.Content className="flex min-w-0 flex-col gap-2">
                  {groups.blocked.map((option) => (
                    <MergeOptionCard
                      key={option.staff.id}
                      option={option}
                      current={option.staff.id === currentId}
                      readOnly={readOnly}
                      selectable={!busy}
                      onSelect={setChosen}
                    />
                  ))}
                </Collapsible.Content>
              </Collapsible.Root>
            ) : null}
            {options.history.length > 0 ? (
              <section aria-label="处理记录" className="flex flex-col gap-2">
                <h4 className="text-sm font-medium text-muted-foreground">
                  处理记录
                </h4>
                <ul className="flex flex-col gap-1.5 text-sm">
                  {options.history.map((entry) => (
                    <li
                      key={`${entry.status}:${entry.staffResourceId}`}
                      className="rounded-md border p-2 break-words"
                    >
                      #{entry.staffResourceId} {cardName(entry.staffName)} ·{' '}
                      {entry.status === 'merged' ? '已合并' : '已驳回'} ·{' '}
                      {entry.handledBy?.name || '—'} ·{' '}
                      {showTime(entry.handledAt)}
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
          </div>
        </div>
      </div>

      <div className="flex shrink-0 flex-wrap items-center gap-2 border-t bg-background px-4 py-2 max-md:sticky max-md:bottom-0 max-md:z-10">
        {readOnly ? (
          <p className="min-w-0 text-sm break-words text-muted-foreground">
            {latestMerged
              ? `已合并：#${userResourceId} ← #${latestMerged.staffResourceId} · ${latestMerged.handledBy?.name || '—'} · ${showTime(latestMerged.handledAt)}`
              : '已合并的记录只读。'}
          </p>
        ) : (
          <>
            <p className="text-sm font-medium tabular-nums">
              当前配对：#{userResourceId} ←{' '}
              {current ? `#${current.staff.id}` : '—'}
            </p>
            {current?.record === 'dismissed' ? (
              <Button
                type="button"
                disabled={busy}
                onClick={() => {
                  setDialogError('')
                  setNotice('')
                  setDialog({
                    kind: 'reopen',
                    staffResourceId: current.staff.id
                  })
                }}
              >
                重开此配对
              </Button>
            ) : current ? (
              <>
                <Button
                  type="button"
                  disabled={!canMerge}
                  onClick={() => openMergeDialog('merge')}
                >
                  合并此配对
                </Button>
                {current.highConfidence ? (
                  <Button
                    type="button"
                    variant="outline"
                    disabled={!canAdd}
                    onClick={() => openMergeDialog('add')}
                  >
                    {inList ? '已在清单中' : '加入批量合并清单'}
                  </Button>
                ) : null}
                <Button
                  type="button"
                  variant="outline"
                  disabled={busy || !current.dismissable}
                  onClick={() => {
                    setDialogError('')
                    setNotice('')
                    setDialog({
                      kind: 'dismiss',
                      staffResourceId: current.staff.id
                    })
                  }}
                >
                  驳回此配对
                </Button>
              </>
            ) : null}
            <span className="flex-1" />
            {dismissable.length > 0 ? (
              <Button
                type="button"
                variant="ghost"
                className="text-destructive hover:text-destructive"
                disabled={busy || dismissable.length > MERGE_DISMISS_CARD_MAX}
                onClick={() => {
                  setDialogError('')
                  setNotice('')
                  setDialog({
                    kind: 'dismissCard',
                    staffResourceIds: dismissable
                  })
                }}
              >
                驳回全部配对
              </Button>
            ) : null}
          </>
        )}
      </div>

      {dialogProps ? (
        <ConfirmActionDialog
          open
          title={dialogProps.title}
          consequence={dialogProps.consequence}
          lines={'lines' in dialogProps ? dialogProps.lines : undefined}
          confirmLabel={dialogProps.confirmLabel}
          requireConfirmation={
            'requireConfirmation' in dialogProps
              ? dialogProps.requireConfirmation
              : undefined
          }
          tone={dialogProps.tone}
          pending={pending}
          error={dialogError}
          onOpenChange={(open) => {
            if (!open) closeDialog()
          }}
          onConfirm={dialogProps.onConfirm}
        />
      ) : null}
    </div>
  )
}
