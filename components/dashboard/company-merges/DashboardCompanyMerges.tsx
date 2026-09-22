'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import toast from 'react-hot-toast'
import { RefreshCw, ScanSearch } from 'lucide-react'
import { Badge } from '~/components/dashboard/ui/badge'
import { Button } from '~/components/dashboard/ui/button'
import { Skeleton } from '~/components/dashboard/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from '~/components/dashboard/ui/table'
import { Tabs, TabsList, TabsTrigger } from '~/components/dashboard/ui/tabs'
import { kunFetchGet, kunFetchPost } from '~/utils/kunFetch'
import { formatChinaDateTime } from '~/utils/fixedTimezoneDate'
import {
  getCompanyMergeResolutionSourceLabel,
  getCompanyMergeSuggestionKindLabel,
  LEGACY_COMPANY_MERGE_SELECTION_LABEL,
  type CompanyMergeDetectResponse,
  type CompanyMergeSuggestion,
  type CompanyMergeSuggestionListResponse,
  type CompanyMergeSuggestionStatus
} from '~/types/api/companyMerges'
import { DismissSuggestionDialog } from './DismissSuggestionDialog'
import { MergeSuggestionDialog } from './MergeSuggestionDialog'
import { ReopenSuggestionDialog } from './ReopenSuggestionDialog'

const SKELETON_ROWS = 3
const FALLBACK_ERROR = '获取会社合并建议失败，请稍后重试'
const NETWORK_ERROR = '网络错误，请检查网络连接后重试'
const DETECT_FALLBACK_ERROR = '检测失败，请稍后重试'

const STATUS_TABS: Array<{
  value: CompanyMergeSuggestionStatus
  label: string
}> = [
  { value: 'pending', label: '待处理' },
  { value: 'dismissed', label: '已驳回' },
  { value: 'accepted', label: '已合并' }
]

const EMPTY_COPY: Record<
  CompanyMergeSuggestionStatus,
  { title: string; hint: string }
> = {
  pending: {
    title: '没有待处理的会社合并建议',
    hint: '点「检测」扫描一次会社表'
  },
  dismissed: {
    title: '没有已驳回的会社合并建议',
    hint: '驳回后会出现在这里，可以重新打开'
  },
  accepted: {
    title: '没有已合并的记录',
    hint: '确认合并后会出现在这里'
  }
}

const COMPANY_LINK_CLASS =
  'rounded-sm text-primary underline-offset-4 hover:underline focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none'

const clusterCompanyIds = (suggestion: CompanyMergeSuggestion) => [
  suggestion.targetCompanyId,
  ...suggestion.sourceCompanyIds
]

const formatCompanyIds = (ids: number[] | null) =>
  ids === null
    ? LEGACY_COMPANY_MERGE_SELECTION_LABEL
    : ids.map((id) => `#${id}`).join('、')

const HistoryOutcome = ({
  suggestion
}: {
  suggestion: CompanyMergeSuggestion
}) => (
  <div className="flex max-w-xs flex-col gap-1 text-xs text-muted-foreground">
    <span>
      来源：{getCompanyMergeResolutionSourceLabel(suggestion.resolutionSource)}
    </span>
    {suggestion.status === 'accepted' ? (
      <>
        <span>勾选：{formatCompanyIds(suggestion.selectedCompanyIds)}</span>
        <span>
          留下：
          {suggestion.appliedTargetCompanyId === null
            ? LEGACY_COMPANY_MERGE_SELECTION_LABEL
            : `#${suggestion.appliedTargetCompanyId}`}
        </span>
        <span>
          删除：{formatCompanyIds(suggestion.appliedSourceCompanyIds)}
        </span>
      </>
    ) : null}
  </div>
)

const operatorLabel = (suggestion: CompanyMergeSuggestion) => {
  if (suggestion.resolvedByUserId == null) return '—'
  if (suggestion.resolvedByName) {
    return `${suggestion.resolvedByName}（#${suggestion.resolvedByUserId}）`
  }
  return `#${suggestion.resolvedByUserId}`
}

const CompanyLabel = ({
  companyId,
  frozenName,
  liveName
}: {
  companyId: number
  frozenName: string | undefined
  liveName: string | null | undefined
}) => {
  const label = frozenName?.trim() || `#${companyId}`
  if (liveName == null) {
    return (
      <span className="text-sm">
        {label}
        <span className="text-xs text-muted-foreground">
          {' '}
          #{companyId}（已不存在）
        </span>
      </span>
    )
  }
  return (
    <a
      href={`/company/${companyId}`}
      target="_blank"
      rel="noreferrer"
      className={COMPANY_LINK_CLASS}
    >
      {label}
      <span className="text-xs text-muted-foreground"> #{companyId}</span>
    </a>
  )
}

const SuggestionCompanies = ({
  suggestion,
  showTargetBadge
}: {
  suggestion: CompanyMergeSuggestion
  showTargetBadge: boolean
}) => {
  const ids = clusterCompanyIds(suggestion)
  return (
    <div className="flex flex-col gap-1">
      {ids.map((companyId, index) => {
        const participant = suggestion.participants[index]
        const label = (
          <CompanyLabel
            companyId={companyId}
            frozenName={suggestion.names[index]}
            liveName={participant?.name}
          />
        )
        if (index === 0 && showTargetBadge) {
          return (
            <span
              key={`${suggestion.id}-company-${companyId}`}
              className="flex items-center gap-2 text-sm font-medium"
            >
              <Badge variant="secondary">目标</Badge>
              {label}
            </span>
          )
        }
        return (
          <span
            key={`${suggestion.id}-company-${companyId}`}
            className={
              showTargetBadge
                ? 'flex items-center gap-2 pl-4 text-sm text-muted-foreground'
                : 'flex items-center gap-2 text-sm'
            }
          >
            {label}
          </span>
        )
      })}
    </div>
  )
}

/**
 * Company merge queue plus dismissed/accepted history. Detect only scans
 * `patch_company` and writes suggestions; 驳回 / 重新打开 record the decision
 * and touch nothing else; 合并 is the one action that writes company rows,
 * through the same writer as the offline cleanup.
 *
 * 检测按钮始终显示：秒表与检测请求挂在页签外，切换页签不丢秒表；完成后刷新
 * 当前页签。检测只按 member_key 跳过已驳回或已合并的组合，折叠键只展示。
 */
export const DashboardCompanyMerges = () => {
  const [status, setStatus] = useState<CompanyMergeSuggestionStatus>('pending')
  const [items, setItems] = useState<CompanyMergeSuggestion[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [detecting, setDetecting] = useState(false)
  const [detectElapsedSec, setDetectElapsedSec] = useState(0)
  const [refreshNonce, setRefreshNonce] = useState(0)
  const requestSeq = useRef(0)
  const detectInflightRef = useRef(false)
  const loadedStatusRef = useRef<CompanyMergeSuggestionStatus | null>(null)
  const listRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const seq = ++requestSeq.current
    let active = true
    setLoading(true)
    setError(null)
    if (loadedStatusRef.current !== status) {
      setItems(null)
    }
    kunFetchGet<CompanyMergeSuggestionListResponse | string>(
      '/admin/company-merges',
      { status }
    )
      .then((res) => {
        if (!active || seq !== requestSeq.current) return
        if (typeof res === 'string') {
          setItems(null)
          setError(res.trim() === '' ? FALLBACK_ERROR : res)
          return
        }
        if (res && Array.isArray(res.items)) {
          loadedStatusRef.current = status
          setItems(res.items)
          return
        }
        setItems(null)
        setError(FALLBACK_ERROR)
      })
      .catch(() => {
        if (!active || seq !== requestSeq.current) return
        setItems(null)
        setError(NETWORK_ERROR)
      })
      .finally(() => {
        if (!active || seq !== requestSeq.current) return
        setLoading(false)
      })
    return () => {
      active = false
    }
  }, [refreshNonce, status])

  const refresh = useCallback(() => setRefreshNonce((nonce) => nonce + 1), [])

  useEffect(() => {
    if (!detecting) {
      setDetectElapsedSec(0)
      return
    }
    const started = Date.now()
    const tick = () =>
      setDetectElapsedSec(Math.floor((Date.now() - started) / 1000))
    tick()
    const id = window.setInterval(tick, 1000)
    return () => window.clearInterval(id)
  }, [detecting])

  const handleDetect = async () => {
    if (detectInflightRef.current) {
      return
    }
    detectInflightRef.current = true
    setDetecting(true)
    try {
      const res = await kunFetchPost<CompanyMergeDetectResponse | string>(
        '/admin/company-merges/detect'
      )
      if (typeof res === 'string') {
        toast.error(res.trim() || DETECT_FALLBACK_ERROR)
        return
      }
      if (!res || typeof res.created !== 'number') {
        toast.error(DETECT_FALLBACK_ERROR)
        return
      }
      const seconds = Math.max(1, Math.round((res.durationMs ?? 0) / 1000))
      const extra =
        Array.isArray(res.notes) && res.notes.length > 0
          ? `（${res.notes.join('；')}）`
          : ''
      toast.success(
        `检测完成：新增 ${res.created} 条，更新 ${res.updated} 条，跳过 ${res.skipped} 条，耗时 ${seconds}s${extra}`
      )
      refresh()
    } catch {
      toast.error('网络异常，检测结果未知，请刷新列表后核对')
    } finally {
      detectInflightRef.current = false
      setDetecting(false)
    }
  }

  const handleResolved = useCallback((id: number) => {
    setItems((prev) =>
      prev === null ? prev : prev.filter((item) => item.id !== id)
    )
  }, [])

  const empty = EMPTY_COPY[status]
  const showOperator = status !== 'pending'
  const showSurviving = status === 'accepted'
  const showOutcome = status !== 'pending'
  const showFoldedKey = status === 'pending'
  const showActions = status !== 'accepted'

  const listContent =
    loading && items === null ? (
      <div role="status" aria-busy="true" aria-label="正在加载会社合并建议">
        {Array.from({ length: SKELETON_ROWS }).map((_, index) => (
          <Skeleton
            key={`merge-skeleton-${index}`}
            className="mb-2 h-16 w-full"
          />
        ))}
      </div>
    ) : error !== null ? (
      <div className="flex flex-col items-center justify-center gap-3 rounded-md border py-10">
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
        <Button variant="outline" size="sm" onClick={refresh}>
          重试
        </Button>
      </div>
    ) : items === null || items.length === 0 ? (
      <div className="flex h-32 flex-col items-center justify-center gap-2 rounded-md border text-center">
        <p className="text-sm text-muted-foreground">{empty.title}</p>
        <p className="text-xs text-muted-foreground">{empty.hint}</p>
      </div>
    ) : (
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              {status !== 'pending' ? <TableHead>时间</TableHead> : null}
              {status === 'pending' ? <TableHead>会社</TableHead> : null}
              <TableHead>类型</TableHead>
              {status !== 'pending' ? <TableHead>会社</TableHead> : null}
              {showSurviving ? <TableHead>主会社</TableHead> : null}
              {showOutcome ? <TableHead>结果</TableHead> : null}
              {showFoldedKey ? <TableHead>折叠键</TableHead> : null}
              {status === 'pending' ? <TableHead>检测时间</TableHead> : null}
              {showOperator ? <TableHead>操作者</TableHead> : null}
              {showActions ? (
                <TableHead className="text-right">操作</TableHead>
              ) : null}
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((suggestion) => {
              const survivingId =
                suggestion.appliedTargetCompanyId ??
                Math.min(...clusterCompanyIds(suggestion))
              const survivingKnown = suggestion.appliedTargetCompanyId !== null
              const survivingIndex =
                clusterCompanyIds(suggestion).indexOf(survivingId)
              const survivingParticipant =
                suggestion.participants[survivingIndex]
              const timeValue =
                status === 'pending'
                  ? suggestion.detectedAt
                  : (suggestion.resolvedAt ?? suggestion.detectedAt)
              return (
                <TableRow key={suggestion.id}>
                  {status !== 'pending' ? (
                    <TableCell className="align-top text-sm text-muted-foreground">
                      {formatChinaDateTime(timeValue)}
                    </TableCell>
                  ) : null}
                  {status === 'pending' ? (
                    <TableCell className="align-top">
                      <SuggestionCompanies
                        suggestion={suggestion}
                        showTargetBadge
                      />
                    </TableCell>
                  ) : null}
                  <TableCell className="align-top text-sm">
                    {getCompanyMergeSuggestionKindLabel(suggestion.kind)}
                  </TableCell>
                  {status !== 'pending' ? (
                    <TableCell className="align-top">
                      <SuggestionCompanies
                        suggestion={suggestion}
                        showTargetBadge={false}
                      />
                    </TableCell>
                  ) : null}
                  {showSurviving ? (
                    <TableCell className="align-top">
                      {survivingKnown ? (
                        <CompanyLabel
                          companyId={survivingId}
                          frozenName={suggestion.names[survivingIndex]}
                          liveName={survivingParticipant?.name}
                        />
                      ) : (
                        <span className="text-sm text-muted-foreground">
                          {LEGACY_COMPANY_MERGE_SELECTION_LABEL}
                        </span>
                      )}
                    </TableCell>
                  ) : null}
                  {showOutcome ? (
                    <TableCell className="align-top">
                      <HistoryOutcome suggestion={suggestion} />
                    </TableCell>
                  ) : null}
                  {showFoldedKey ? (
                    <TableCell className="align-top">
                      <code className="rounded bg-muted px-1 text-xs break-all">
                        {suggestion.foldedKey}
                      </code>
                    </TableCell>
                  ) : null}
                  {status === 'pending' ? (
                    <TableCell className="align-top text-sm text-muted-foreground">
                      {formatChinaDateTime(timeValue)}
                    </TableCell>
                  ) : null}
                  {showOperator ? (
                    <TableCell className="align-top text-sm text-muted-foreground">
                      {operatorLabel(suggestion)}
                    </TableCell>
                  ) : null}
                  {showActions ? (
                    <TableCell className="text-right align-top">
                      <div className="flex justify-end gap-2">
                        {status === 'pending' ? (
                          <>
                            <MergeSuggestionDialog
                              suggestion={suggestion}
                              onMerged={handleResolved}
                              fallbackFocusRef={listRef}
                            />
                            <DismissSuggestionDialog
                              suggestion={suggestion}
                              onDismissed={handleResolved}
                              fallbackFocusRef={listRef}
                            />
                          </>
                        ) : (
                          <ReopenSuggestionDialog
                            suggestion={suggestion}
                            onReopened={handleResolved}
                            fallbackFocusRef={listRef}
                          />
                        )}
                      </div>
                    </TableCell>
                  ) : null}
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </div>
    )

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col gap-4 overflow-y-auto p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          onClick={handleDetect}
          disabled={detecting}
          className="cursor-pointer disabled:cursor-default"
        >
          <ScanSearch />
          {detecting ? '检测中…' : '检测'}
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={refresh}
          disabled={loading}
          className="cursor-pointer disabled:cursor-default"
        >
          <RefreshCw className={loading ? 'animate-spin' : undefined} />
          刷新
        </Button>
        <p
          className="text-sm text-muted-foreground"
          aria-live="polite"
          role={detecting ? 'status' : undefined}
        >
          {detecting
            ? `检测中（已等待 ${detectElapsedSec}s）。先跑本地规则，再查 VNDB；NextMoe 超时或 522 会跳过，终端会打 [company-merges:detect] 日志。`
            : '检测只生成建议；合并与驳回都要在这里手动确认。'}
        </p>
      </div>

      <Tabs
        value={status}
        onValueChange={(value) =>
          setStatus(value as CompanyMergeSuggestionStatus)
        }
      >
        <TabsList>
          {STATUS_TABS.map((tab) => (
            <TabsTrigger
              key={tab.value}
              value={tab.value}
              className="cursor-pointer"
            >
              {tab.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      <div
        ref={listRef}
        tabIndex={-1}
        role="region"
        aria-label="会社合并建议列表"
        className="outline-none"
      >
        {listContent}
      </div>
    </div>
  )
}
