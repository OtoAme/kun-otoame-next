'use client'

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState
} from 'react'
import {
  SearchableListPage,
  type FilterChip,
  type FilterContext,
  type ListColumn
} from '~/components/dashboard/page/SearchableListPage'
import { ConfirmActionDialog } from './ConfirmActionDialog'
import { Badge } from '~/components/dashboard/ui/badge'
import { Button } from '~/components/dashboard/ui/button'
import { Checkbox } from '~/components/dashboard/ui/checkbox'
import { Label } from '~/components/dashboard/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '~/components/dashboard/ui/select'
import { Tabs, TabsList, TabsTrigger } from '~/components/dashboard/ui/tabs'
import {
  RESOURCE_SECTION_MAP,
  SUPPORTED_LANGUAGE_MAP,
  SUPPORTED_PLATFORM_MAP,
  SUPPORTED_RESOURCE_LINK_MAP,
  SUPPORTED_TYPE_MAP
} from '~/constants/resource'
import { formatBackupDate } from '~/components/patch/resource/publicMirrorFacts'
import type { SearchableListConfig } from '~/hooks/dashboard/useSearchableList'
import { kunFetchGet, kunFetchPost } from '~/utils/kunFetch'
import type {
  MergeBatchResult,
  MergePreview,
  MergeResult,
  MergeTab,
  OfficialMirrorCacheRefresh,
  PairClass
} from '~/types/api/officialMirror'
import {
  acceptMergeListRow,
  isBackupBasis,
  MERGE_BATCH_MAX,
  MERGE_TABS,
  notifyOfficialMirrorQueue,
  PAIR_CLASSES,
  shouldApplyPreview,
  type MergeListRow
} from './contract'
import { cacheRefreshBody, type CacheRefreshRequest } from './cacheRefresh'
import {
  batchReportLines,
  batchRequestPairs,
  confirmPairContent,
  highConfidencePairs,
  mergePairKey,
  type ConfirmedMergePair
} from './mergeConfirmation'

const joined = (values: readonly string[], labels: Record<string, string>) =>
  values.length ? values.map((value) => labels[value] ?? value).join('、') : '—'

function SurvivorCard({
  preview
}: {
  preview: MergePreview['survivorPreview']
}) {
  const links = [...preview.links].sort(
    (left, right) => left.sortOrder - right.sortOrder || left.id - right.id
  )
  return (
    <section
      aria-label="合并后的卡片"
      className="flex min-w-0 flex-col gap-2 rounded-lg border p-3"
    >
      <h5 className="font-medium">合并后的卡片</h5>
      <p className="break-words">{preview.name || '未命名资源'}</p>
      <p className="break-words">
        类型：{joined(preview.type, SUPPORTED_TYPE_MAP)}
      </p>
      <p className="break-words">
        语言：{joined(preview.language, SUPPORTED_LANGUAGE_MAP)}
      </p>
      <p className="break-words">
        平台：{joined(preview.platform, SUPPORTED_PLATFORM_MAP)}
      </p>
      <p className="break-words whitespace-pre-wrap">
        备注：{preview.note || '无备注'}
        {preview.noteAppended ? '（已附上站方备注）' : ''}
      </p>
      <ul className="flex min-w-0 flex-col gap-2">
        {links.map((link) => {
          const backup = link.backedUpAt
            ? formatBackupDate(link.backedUpAt)
            : null
          const backed = link.storage === 'touchgal' || link.backedUpAt !== null
          return (
            <li key={link.id} className="min-w-0 rounded-md border p-2">
              <div className="flex flex-wrap items-center gap-2">
                <span>
                  {SUPPORTED_RESOURCE_LINK_MAP[link.storage] ?? link.storage}
                </span>
                <span className="text-muted-foreground">
                  {link.size || '无大小'}
                </span>
                {backed ? (
                  <Badge variant="outline">
                    站方备份{backup ? ` ${backup}` : ''}
                  </Badge>
                ) : (
                  <span className="text-muted-foreground">无站方备份</span>
                )}
              </div>
              <p className="mt-1 font-mono text-xs break-all">{link.content}</p>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

const TAB_LABEL: Record<MergeTab, string> = {
  pending: '待处理',
  dismissed: '已驳回',
  merged: '已合并'
}

const CLASS_LABEL: Record<PairClass, string> = {
  high: '高置信',
  manual: '需人工核对'
}

const UNIQUE_ID = /^[A-Za-z0-9]{8}$/

const oneOf =
  (allowed: readonly string[]) =>
  (raw: string): string | null =>
    allowed.includes(raw) ? raw : null

const MERGE_LIST_CONFIG: SearchableListConfig = {
  endpoint: '/admin/resource-merges',
  field: 'items',
  fallbackError: '获取资源合并队列失败，请稍后重试',
  acceptRow: acceptMergeListRow,
  filters: {
    tab: oneOf(MERGE_TABS),
    pairClass: oneOf(PAIR_CLASSES),
    section: oneOf(['galgame', 'patch'])
  },
  defaultParams: { tab: 'pending' }
}

const COLUMNS: ListColumn<MergeListRow>[] = [
  {
    key: 'game',
    header: '游戏',
    grow: true,
    cell: (row) => row.userResource.patchName || '—'
  },
  {
    key: 'name',
    header: '用户卡片',
    minWidth: 720,
    cell: (row) => row.userResource.name || '未命名资源'
  },
  {
    key: 'class',
    header: '配对',
    minWidth: 960,
    cell: (row) =>
      `${CLASS_LABEL[row.pairClass] ?? row.pairClass} · ${row.candidateCount}`
  },
  {
    key: 'download',
    header: '获取次数',
    minWidth: 1100,
    align: 'right',
    cell: (row) => row.userResource.download
  }
]

type BatchCacheState = {
  cacheRefreshed: boolean
  retry: CacheRefreshRequest | null
  pending: boolean
  error: string
}

type ShownBatch = {
  seq: number
  result: MergeBatchResult
  authors: Record<string, { authorId: number; staffAuthorId: number | null }>
  cache: Record<string, BatchCacheState>
}

type MergeActions = {
  pairs: ConfirmedMergePair[]
  replacePair: (
    userResourceId: number,
    staffResourceId: number,
    pair: ConfirmedMergePair | null
  ) => void
  dropMatchingBasis: (
    userResourceId: number,
    staffResourceId: number,
    basis: string
  ) => void
  report: ShownBatch | null
  batchError: string
  batchPending: boolean
  requestBatch: () => void
  retryBatchCache: (key: string) => void
  setTab: (tab: MergeTab) => void
}

const MergeActionContext = createContext<MergeActions | null>(null)

const useMergeActions = () => {
  const value = useContext(MergeActionContext)
  if (!value) throw new Error('资源合并操作缺少上下文')
  return value
}

const survivorHref = (preview: {
  patchUniqueId: string
  section: string
  id: number
}) => {
  if (!UNIQUE_ID.test(preview.patchUniqueId)) return null
  const params = new URLSearchParams({
    tab: 'resources',
    resourceSection: preview.section,
    resourceId: String(preview.id)
  })
  return `/${preview.patchUniqueId}?${params.toString()}`
}

function MergeToolbar({ filters, setFilters }: FilterContext) {
  const {
    pairs,
    report,
    batchError,
    batchPending,
    requestBatch,
    retryBatchCache,
    setTab
  } = useMergeActions()
  const tab = (filters.tab as MergeTab | undefined) ?? 'pending'
  useEffect(() => {
    setTab(tab)
  }, [setTab, tab])
  const highPairs = highConfidencePairs(pairs)
  const overLimit = highPairs.length > MERGE_BATCH_MAX
  return (
    <div className="flex min-w-0 flex-col gap-3">
      <Tabs
        value={tab}
        onValueChange={(value) =>
          setFilters({ tab: value === 'pending' ? '' : value })
        }
      >
        <TabsList>
          {MERGE_TABS.map((item) => (
            <TabsTrigger key={item} value={item}>
              {TAB_LABEL[item]}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
      {tab === 'pending' && filters.pairClass === 'high' ? (
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
          <Button
            type="button"
            disabled={batchPending || highPairs.length < 1 || overLimit}
            onClick={requestBatch}
          >
            {batchPending ? '正在合并…' : '合并所选'}
          </Button>
          {overLimit ? (
            <p className="text-sm text-muted-foreground">
              一次最多 {MERGE_BATCH_MAX} 对。
            </p>
          ) : null}
        </div>
      ) : null}
      {batchError ? (
        <p role="alert" className="text-sm text-destructive">
          {batchError}
        </p>
      ) : null}
      {report ? (
        <div className="rounded-lg border p-3 text-sm">
          <h3 className="font-medium">本批结果</h3>
          <ul className="mt-2 flex flex-col gap-2">
            {report.result.outcomes.map((item) => {
              const key = mergePairKey(
                item.userResourceId,
                item.staffResourceId
              )
              const cache = report.cache[key]
              const line = batchReportLines({
                outcomes: [item],
                remaining: []
              })[0]
              return (
                <li key={key} className="min-w-0 break-words">
                  <p>{line}</p>
                  {item.status === 'merged' && cache ? (
                    cache.cacheRefreshed ? (
                      <p>页面缓存已刷新。</p>
                    ) : (
                      <>
                        <p>页面缓存没有刷新。</p>
                        {cache.retry ? (
                          <Button
                            type="button"
                            variant="outline"
                            disabled={cache.pending}
                            aria-label={`仅刷新缓存 #${item.userResourceId} / #${item.staffResourceId}`}
                            onClick={() => retryBatchCache(key)}
                          >
                            {cache.pending ? '正在刷新缓存…' : '仅刷新缓存'}
                          </Button>
                        ) : (
                          <p className="text-muted-foreground">
                            没有可用的页面标识，不能刷新缓存。
                          </p>
                        )}
                      </>
                    )
                  ) : null}
                  {cache?.error ? (
                    <p role="alert" className="text-destructive">
                      {cache.error}
                    </p>
                  ) : null}
                </li>
              )
            })}
            {report.result.remaining.map((item) => (
              <li
                key={`remaining:${mergePairKey(item.userResourceId, item.staffResourceId)}`}
                className="break-words"
              >
                #{item.userResourceId} / #{item.staffResourceId} 未开始
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  )
}

function MergeFilters({ filters, setFilters }: FilterContext) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="merge-section">分区</Label>
        <Select
          value={filters.section ?? 'all'}
          onValueChange={(value) =>
            setFilters({ section: value === 'all' ? '' : value })
          }
        >
          <SelectTrigger id="merge-section" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部分区</SelectItem>
            {Object.entries(RESOURCE_SECTION_MAP).map(([key, label]) => (
              <SelectItem key={key} value={key}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="merge-class">配对</Label>
        <Select
          value={filters.pairClass ?? 'all'}
          onValueChange={(value) =>
            setFilters({ pairClass: value === 'all' ? '' : value })
          }
        >
          <SelectTrigger id="merge-class" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部配对</SelectItem>
            {PAIR_CLASSES.map((item) => (
              <SelectItem key={item} value={item}>
                {CLASS_LABEL[item]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  )
}

type MergeCacheResult = {
  userResourceId: number
  staffResourceId: number
  cacheRefreshed: boolean
  retry: CacheRefreshRequest | null
  pending: boolean
  error: string
}

function MergeDetail({
  row,
  tab,
  onChanged,
  onSettled
}: {
  row: MergeListRow
  tab: MergeTab
  onChanged: () => void
  onSettled: (result: {
    userResourceId: number
    staffResourceId: number
    cacheRefreshed: boolean
    retry: CacheRefreshRequest | null
  }) => void
}) {
  const { pairs, replacePair, dropMatchingBasis } = useMergeActions()
  const [staffResourceId, setStaffResourceId] = useState<number | null>(
    row.candidates[0]?.staffResourceId ?? null
  )
  const [preview, setPreview] = useState<MergePreview | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [confirm, setConfirm] = useState<'merge' | 'dismiss' | 'reopen' | null>(
    null
  )
  const [pending, setPending] = useState(false)
  const requestRef = useRef({
    seq: 0,
    userResourceId: 0,
    staffResourceId: 0
  })

  useEffect(() => {
    setStaffResourceId(row.candidates[0]?.staffResourceId ?? null)
    setPreview(null)
    setError('')
    setConfirm(null)
    setPending(false)
  }, [row.id, row.candidates])

  useEffect(() => {
    if (staffResourceId === null || tab === 'merged') {
      setPreview(null)
      setLoading(false)
      return
    }
    const seq = requestRef.current.seq + 1
    const request = {
      seq,
      userResourceId: row.userResource.id,
      staffResourceId
    }
    requestRef.current = request
    let active = true
    setLoading(true)
    setPreview(null)
    setError('')
    setConfirm(null)
    setPending(false)
    void kunFetchGet<MergePreview | string>('/admin/resource-merges/preview', {
      userResourceId: row.userResource.id,
      staffResourceId
    })
      .then((body) => {
        if (!active || !shouldApplyPreview(request, requestRef.current)) return
        if (typeof body === 'string') {
          setError(body || '读取合并预览失败，请稍后重试')
          return
        }
        if (
          body.user.id !== row.userResource.id ||
          body.staff.id !== staffResourceId
        ) {
          return
        }
        setPreview(body)
      })
      .catch(() => {
        if (active && shouldApplyPreview(request, requestRef.current)) {
          setError('网络错误，请稍后重试')
        }
      })
      .finally(() => {
        if (active && shouldApplyPreview(request, requestRef.current)) {
          setLoading(false)
        }
      })
    return () => {
      active = false
    }
  }, [row.userResource.id, staffResourceId, tab])

  const confirmed =
    staffResourceId === null
      ? null
      : (pairs.find(
          (pair) =>
            pair.userResourceId === row.userResource.id &&
            pair.staffResourceId === staffResourceId
        ) ?? null)
  const basisReady = preview ? isBackupBasis(preview.basis) : false
  const canConfirm = Boolean(preview?.canMerge && basisReady)
  const href = survivorHref(row.userResource)

  const stillPair = (request: {
    seq: number
    userResourceId: number
    staffResourceId: number
  }) => shouldApplyPreview(request, requestRef.current)

  const finish = async (
    path:
      | '/admin/resource-merges/merge'
      | '/admin/resource-merges/dismiss'
      | '/admin/resource-merges/reopen',
    body: Record<string, unknown>,
    submitted: {
      userResourceId: number
      staffResourceId: number
      basis: string | null
      authorId: number
      staffAuthorId: number | null
    }
  ) => {
    const request = {
      seq: requestRef.current.seq,
      userResourceId: submitted.userResourceId,
      staffResourceId: submitted.staffResourceId
    }
    setPending(true)
    setError('')
    try {
      if (path === '/admin/resource-merges/merge') {
        const response = await kunFetchPost<MergeResult | string>(path, body)
        if (typeof response === 'string') {
          if (stillPair(request)) setError(response || '操作失败，请稍后重试')
          return
        }
        if (
          response.userResourceId !== request.userResourceId ||
          response.staffResourceId !== request.staffResourceId ||
          response.resourceId !== request.userResourceId ||
          typeof response.cacheRefreshed !== 'boolean'
        ) {
          if (stillPair(request)) {
            setError('没有确认这次操作是否已经写入，请刷新核对后再操作')
          }
          return
        }
        if (submitted.basis) {
          dropMatchingBasis(
            request.userResourceId,
            request.staffResourceId,
            submitted.basis
          )
        }
        const retry = response.cacheRefreshed
          ? null
          : cacheRefreshBody({
              patchUniqueId: response.patchUniqueId,
              authorIds: [submitted.authorId, submitted.staffAuthorId]
            })
        notifyOfficialMirrorQueue()
        if (!stillPair(request)) return
        setConfirm(null)
        onSettled({
          userResourceId: request.userResourceId,
          staffResourceId: request.staffResourceId,
          cacheRefreshed: response.cacheRefreshed,
          retry
        })
        onChanged()
        return
      }
      const response = await kunFetchPost<{ changed?: unknown } | string>(
        path,
        body
      )
      if (typeof response === 'string') {
        if (stillPair(request)) setError(response || '操作失败，请稍后重试')
        return
      }
      if (!response || typeof response.changed !== 'boolean') {
        if (stillPair(request)) {
          setError('没有确认这次操作是否已经写入，请刷新核对后再操作')
        }
        return
      }
      if (submitted.basis) {
        dropMatchingBasis(
          request.userResourceId,
          request.staffResourceId,
          submitted.basis
        )
      }
      if (!stillPair(request)) return
      setConfirm(null)
      notifyOfficialMirrorQueue()
      onChanged()
    } catch {
      if (stillPair(request)) setError('网络错误，请稍后重试')
    } finally {
      if (stillPair(request)) setPending(false)
    }
  }

  const classification = preview?.classification ?? row.pairClass
  const blockItems = preview
    ? [
        ...preview.blocks,
        ...row.blocks.filter(
          (block) => !preview.blocks.some((item) => item.code === block.code)
        )
      ]
    : []

  return (
    <div className="flex flex-col gap-4">
      <div className="min-w-0">
        <h4 className="break-words text-base font-semibold">
          {row.userResource.name || '未命名资源'}
        </h4>
        <p className="break-words text-sm text-muted-foreground">
          {row.userResource.patchName || '—'} ·{' '}
          {CLASS_LABEL[row.pairClass] ?? row.pairClass} · 获取次数{' '}
          {row.userResource.download}
        </p>
      </div>
      <p className="text-sm">
        分类：{CLASS_LABEL[classification] ?? classification}
        {preview ? (preview.canMerge ? ' · 可以合并' : ' · 当前不能合并') : ''}
      </p>
      {tab === 'merged' && href ? (
        <a
          href={href}
          className="text-sm underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          查看合并后的资源
        </a>
      ) : null}
      {row.candidates.length > 0 ? (
        <div className="flex flex-col gap-2">
          <p className="text-sm font-medium">候选站方卡片</p>
          {preview ? (
            <p className="break-words text-sm">
              当前 #{preview.staff.id} {preview.staff.name}
            </p>
          ) : null}
          {row.candidates.length > 1 ? (
            <div className="flex flex-wrap gap-2">
              {row.candidates.map((candidate) => (
                <Button
                  key={candidate.staffResourceId}
                  type="button"
                  variant={
                    candidate.staffResourceId === staffResourceId
                      ? 'default'
                      : 'outline'
                  }
                  onClick={() => setStaffResourceId(candidate.staffResourceId)}
                >
                  #{candidate.staffResourceId} {candidate.staffName || '未命名'}
                </Button>
              ))}
            </div>
          ) : (
            <p className="break-words text-sm">
              #{row.candidates[0]?.staffResourceId}{' '}
              {row.candidates[0]?.staffName || '未命名'}
            </p>
          )}
        </div>
      ) : null}
      {loading ? (
        <p className="text-sm text-muted-foreground">正在读取预览…</p>
      ) : null}
      {preview ? (
        <div className="flex flex-col gap-3 text-sm">
          <SurvivorCard preview={preview.survivorPreview} />
          {preview.fieldComparison.length > 0 ? (
            <div>
              <p className="font-medium">字段对照</p>
              <ul className="mt-2 flex flex-col gap-2">
                {preview.fieldComparison.map((field) => (
                  <li key={field.field} className="rounded-lg border p-3">
                    <p className="font-medium">{field.field}</p>
                    <p className="break-words">用户：{field.user || '—'}</p>
                    <p className="break-words">站方：{field.staff || '—'}</p>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {blockItems.length > 0 ? (
            <div>
              <p className="font-medium">阻塞</p>
              <ul className="mt-1 flex flex-col gap-1">
                {blockItems.map((block) => (
                  <li key={block.code} role="status" className="break-words">
                    {block.message}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {preview.exitedPairs.length > 0 ? (
            <div>
              <p className="font-medium">退出配对及保留结果</p>
              <ul className="mt-1 flex flex-col gap-1">
                {preview.exitedPairs.map((pair) => (
                  <li key={pair.staffResourceId} className="break-words">
                    #{pair.staffResourceId} {pair.staffName || '未命名'} 保留
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {!basisReady ? (
            <p role="status">核对基点无效，请刷新后再确认。</p>
          ) : null}
        </div>
      ) : null}
      {error && confirm === null ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      {preview && staffResourceId !== null ? (
        <div className="flex flex-col gap-3">
          {tab === 'pending' ? (
            <div className="flex items-start gap-2">
              <Checkbox
                id={`merge-confirm-${row.userResource.id}-${staffResourceId}`}
                checked={confirmed !== null}
                disabled={!canConfirm || pending}
                onCheckedChange={(value) => {
                  if (!preview) return
                  replacePair(
                    row.userResource.id,
                    staffResourceId,
                    confirmPairContent({
                      checked: value === true,
                      canMerge: preview.canMerge,
                      basis: preview.basis,
                      userResourceId: row.userResource.id,
                      staffResourceId,
                      pairClass: preview.classification,
                      patchUniqueId: preview.user.patchUniqueId,
                      authorId: preview.user.publisher.id,
                      staffAuthorId: preview.staff.publisher.id
                    })
                  )
                }}
              />
              <Label
                htmlFor={`merge-confirm-${row.userResource.id}-${staffResourceId}`}
                className="leading-5"
              >
                确认这两张卡片是同一份内容
              </Label>
            </div>
          ) : null}
          <div className="flex flex-wrap gap-2">
            {tab === 'pending' ? (
              <Button
                type="button"
                disabled={!confirmed || !canConfirm || pending}
                onClick={() => {
                  setError('')
                  setConfirm('merge')
                }}
              >
                合并这一对
              </Button>
            ) : null}
            {tab === 'pending' ? (
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setError('')
                  setConfirm('dismiss')
                }}
              >
                驳回
              </Button>
            ) : null}
            {tab === 'dismissed' ? (
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setError('')
                  setConfirm('reopen')
                }}
              >
                重开
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}
      <ConfirmActionDialog
        open={confirm !== null}
        title={
          confirm === 'merge'
            ? '合并这一对'
            : confirm === 'reopen'
              ? '重开'
              : '驳回这一对'
        }
        consequence={
          confirm === 'merge'
            ? '站方卡片并入这张用户卡片。用户卡片仍留在社区分组，发布者不变。'
            : confirm === 'reopen'
              ? '这一对回到待处理。'
              : '这一对离开待处理。'
        }
        confirmLabel={
          confirm === 'merge' ? '合并' : confirm === 'reopen' ? '重开' : '驳回'
        }
        pending={pending}
        error={error}
        onOpenChange={(open) => {
          if (!open && !pending) {
            setConfirm(null)
            setError('')
          }
        }}
        onConfirm={() => {
          if (pending || staffResourceId === null) return
          const submitted = {
            userResourceId: row.userResource.id,
            staffResourceId,
            basis: confirmed?.basis ?? null,
            authorId: preview?.user.publisher.id ?? 0,
            staffAuthorId: preview?.staff.publisher.id ?? null
          }
          if (confirm === 'merge') {
            if (!preview || !confirmed || confirmed.basis !== preview.basis) {
              setError('预览已变化，请重新确认这两张卡片是同一份内容')
              return
            }
            void finish(
              '/admin/resource-merges/merge',
              {
                userResourceId: row.userResource.id,
                staffResourceId,
                basis: confirmed.basis,
                contentConfirmed: true
              },
              {
                ...submitted,
                basis: confirmed.basis,
                authorId: preview.user.publisher.id,
                staffAuthorId: preview.staff.publisher.id
              }
            )
          } else if (confirm === 'dismiss') {
            void finish(
              '/admin/resource-merges/dismiss',
              {
                userResourceId: row.userResource.id,
                staffResourceId
              },
              submitted
            )
          } else if (confirm === 'reopen') {
            void finish(
              '/admin/resource-merges/reopen',
              {
                userResourceId: row.userResource.id,
                staffResourceId
              },
              submitted
            )
          }
        }}
      />
    </div>
  )
}

const chips = (filters: FilterContext['filters']): FilterChip[] => {
  const items: FilterChip[] = []
  if (filters.section) {
    items.push({
      key: 'section',
      label: RESOURCE_SECTION_MAP[filters.section] ?? filters.section
    })
  }
  if (filters.pairClass === 'high' || filters.pairClass === 'manual') {
    items.push({ key: 'pairClass', label: CLASS_LABEL[filters.pairClass] })
  }
  return items
}

export function DashboardResourceMerges() {
  const [pairs, setPairs] = useState<ConfirmedMergePair[]>([])
  const [report, setReport] = useState<ShownBatch | null>(null)
  const [batchError, setBatchError] = useState('')
  const [batchPending, setBatchPending] = useState(false)
  const [batchOpen, setBatchOpen] = useState(false)
  const [tab, setTab] = useState<MergeTab>('pending')
  const [settled, setSettled] = useState<MergeCacheResult | null>(null)
  const batchLive = useRef(0)
  const reportRef = useRef<ShownBatch | null>(null)
  reportRef.current = report

  const replacePair = (
    userResourceId: number,
    staffResourceId: number,
    pair: ConfirmedMergePair | null
  ) => {
    const key = mergePairKey(userResourceId, staffResourceId)
    setPairs((current) => {
      const rest = current.filter(
        (item) =>
          mergePairKey(item.userResourceId, item.staffResourceId) !== key
      )
      return pair ? [...rest, pair] : rest
    })
  }

  const dropMatchingBasis = (
    userResourceId: number,
    staffResourceId: number,
    basis: string
  ) => {
    const key = mergePairKey(userResourceId, staffResourceId)
    setPairs((current) =>
      current.filter((item) => {
        if (mergePairKey(item.userResourceId, item.staffResourceId) !== key) {
          return true
        }
        return item.basis !== basis
      })
    )
  }

  const retryBatchCache = async (key: string) => {
    const current = reportRef.current
    const item = current?.cache[key]
    if (!current || !item?.retry || item.pending) return
    if (batchLive.current !== current.seq) return
    const seq = current.seq
    const body = item.retry
    setReport((prev) => {
      if (!prev || prev.seq !== seq) return prev
      const row = prev.cache[key]
      if (!row) return prev
      return {
        ...prev,
        cache: { ...prev.cache, [key]: { ...row, pending: true, error: '' } }
      }
    })
    try {
      const response = await kunFetchPost<OfficialMirrorCacheRefresh | string>(
        '/admin/backup/refresh-cache',
        body
      )
      if (batchLive.current !== seq) return
      setReport((prev) => {
        if (!prev || prev.seq !== seq) return prev
        const row = prev.cache[key]
        if (!row) return prev
        if (typeof response === 'string') {
          return {
            ...prev,
            cache: {
              ...prev.cache,
              [key]: {
                ...row,
                pending: false,
                error: response || '刷新缓存失败，请稍后重试'
              }
            }
          }
        }
        if (
          response.cacheRefreshed !== true ||
          response.uniqueIds[0] !== body.uniqueIds[0]
        ) {
          return {
            ...prev,
            cache: {
              ...prev.cache,
              [key]: { ...row, pending: false, error: '页面缓存仍未刷新' }
            }
          }
        }
        return {
          ...prev,
          cache: {
            ...prev.cache,
            [key]: {
              cacheRefreshed: true,
              retry: null,
              pending: false,
              error: ''
            }
          }
        }
      })
    } catch {
      if (batchLive.current !== seq) return
      setReport((prev) => {
        if (!prev || prev.seq !== seq) return prev
        const row = prev.cache[key]
        if (!row) return prev
        return {
          ...prev,
          cache: {
            ...prev.cache,
            [key]: { ...row, pending: false, error: '网络错误，缓存没有刷新' }
          }
        }
      })
    }
  }

  const actions = useMemo<MergeActions>(
    () => ({
      pairs,
      replacePair,
      dropMatchingBasis,
      report,
      batchError,
      batchPending,
      requestBatch: () => {
        setBatchError('')
        setBatchOpen(true)
      },
      retryBatchCache,
      setTab
    }),
    [pairs, report, batchError, batchPending]
  )

  const runBatch = async () => {
    const snapshot = highConfidencePairs(pairs)
    const body = batchRequestPairs(snapshot)
    if (!body || batchPending) {
      setBatchError(
        snapshot.length > MERGE_BATCH_MAX
          ? `一次最多合并 ${MERGE_BATCH_MAX} 对`
          : '没有已确认的高置信配对'
      )
      setBatchOpen(false)
      return
    }
    const seq = batchLive.current + 1
    batchLive.current = seq
    const authors: ShownBatch['authors'] = {}
    for (const pair of snapshot) {
      authors[mergePairKey(pair.userResourceId, pair.staffResourceId)] = {
        authorId: pair.authorId,
        staffAuthorId: pair.staffAuthorId
      }
    }
    setBatchPending(true)
    setBatchError('')
    try {
      const response = await kunFetchPost<MergeBatchResult | string>(
        '/admin/resource-merges/batch',
        { pairs: body }
      )
      if (batchLive.current !== seq) return
      if (typeof response === 'string') {
        setBatchError(response || '批量合并失败，请稍后重试')
        return
      }
      const cache: ShownBatch['cache'] = {}
      for (const item of response.outcomes) {
        if (
          item.status !== 'merged' ||
          typeof item.result.cacheRefreshed !== 'boolean'
        ) {
          continue
        }
        const key = mergePairKey(item.userResourceId, item.staffResourceId)
        const stored = authors[key]
        cache[key] = {
          cacheRefreshed: item.result.cacheRefreshed,
          retry: item.result.cacheRefreshed
            ? null
            : cacheRefreshBody({
                patchUniqueId: item.result.patchUniqueId,
                authorIds: stored ? [stored.authorId, stored.staffAuthorId] : []
              }),
          pending: false,
          error: ''
        }
      }
      setReport({ seq, result: response, authors, cache })
      const started = new Set(
        response.outcomes.map((item) =>
          mergePairKey(item.userResourceId, item.staffResourceId)
        )
      )
      setPairs((current) =>
        current.filter(
          (item) =>
            !started.has(
              mergePairKey(item.userResourceId, item.staffResourceId)
            )
        )
      )
      setBatchOpen(false)
      notifyOfficialMirrorQueue()
    } catch {
      if (batchLive.current === seq) setBatchError('网络错误，请稍后重试')
    } finally {
      if (batchLive.current === seq) setBatchPending(false)
    }
  }

  const highCount = highConfidencePairs(pairs).length

  const retrySettled = async () => {
    if (!settled?.retry || settled.pending) return
    const userResourceId = settled.userResourceId
    const staffResourceId = settled.staffResourceId
    const body = settled.retry
    setSettled((current) =>
      current &&
      current.userResourceId === userResourceId &&
      current.staffResourceId === staffResourceId
        ? { ...current, pending: true, error: '' }
        : current
    )
    try {
      const response = await kunFetchPost<OfficialMirrorCacheRefresh | string>(
        '/admin/backup/refresh-cache',
        body
      )
      setSettled((current) => {
        if (
          !current ||
          current.userResourceId !== userResourceId ||
          current.staffResourceId !== staffResourceId
        ) {
          return current
        }
        if (typeof response === 'string') {
          return {
            ...current,
            pending: false,
            error: response || '刷新缓存失败，请稍后重试'
          }
        }
        if (
          response.cacheRefreshed !== true ||
          response.uniqueIds[0] !== body.uniqueIds[0]
        ) {
          return { ...current, pending: false, error: '页面缓存仍未刷新' }
        }
        return {
          ...current,
          pending: false,
          cacheRefreshed: true,
          retry: null,
          error: ''
        }
      })
    } catch {
      setSettled((current) =>
        current &&
        current.userResourceId === userResourceId &&
        current.staffResourceId === staffResourceId
          ? { ...current, pending: false, error: '网络错误，缓存没有刷新' }
          : current
      )
    }
  }

  return (
    <MergeActionContext.Provider value={actions}>
      {settled ? (
        <div className="flex flex-col items-start gap-2 px-1">
          <p role="status" className="text-sm">
            已合并
            {settled.cacheRefreshed
              ? '，页面缓存已刷新。'
              : '，页面缓存没有刷新。'}
          </p>
          {settled.cacheRefreshed ? null : settled.retry ? (
            <Button
              type="button"
              variant="outline"
              disabled={settled.pending}
              onClick={() => void retrySettled()}
            >
              {settled.pending ? '正在刷新缓存…' : '仅刷新缓存'}
            </Button>
          ) : (
            <p className="text-sm text-muted-foreground">
              没有可用的页面标识，不能刷新缓存。
            </p>
          )}
          {settled.error ? (
            <p role="alert" className="text-sm text-destructive">
              {settled.error}
            </p>
          ) : null}
        </div>
      ) : null}
      <SearchableListPage<MergeListRow>
        config={MERGE_LIST_CONFIG}
        title="资源合并"
        noun="配对"
        contentLabel="游戏或资源"
        searchByUser={false}
        columns={COLUMNS}
        toolbar={(ctx) => <MergeToolbar {...ctx} />}
        filterPanel={(ctx) => <MergeFilters {...ctx} />}
        filterChips={chips}
        card={(row) => ({
          text: row.userResource.name || '未命名资源',
          meta: `${row.userResource.patchName || '—'} · ${CLASS_LABEL[row.pairClass] ?? row.pairClass} · 获取次数 ${row.userResource.download}`
        })}
        detail={(row, listActions) => (
          <MergeDetail
            key={`${row.userResource.id}:${row.pairClass}`}
            row={row}
            tab={tab}
            onChanged={listActions.onUpdated}
            onSettled={(next) =>
              setSettled({ ...next, pending: false, error: '' })
            }
          />
        )}
      />
      <ConfirmActionDialog
        open={batchOpen}
        title="合并所选"
        consequence={`将合并 ${highCount} 对已逐对确认的高置信配对。`}
        confirmLabel="合并所选"
        pending={batchPending}
        error={batchError}
        onOpenChange={(open) => {
          if (!open && !batchPending) {
            setBatchOpen(false)
            setBatchError('')
          }
        }}
        onConfirm={() => void runBatch()}
      />
    </MergeActionContext.Provider>
  )
}
