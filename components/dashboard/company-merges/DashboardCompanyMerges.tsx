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
import { kunFetchGet, kunFetchPost } from '~/utils/kunFetch'
import { formatChinaDateTime } from '~/utils/fixedTimezoneDate'
import {
  getCompanyMergeSuggestionKindLabel,
  type CompanyMergeDetectResponse,
  type CompanyMergeSuggestion,
  type CompanyMergeSuggestionListResponse
} from '~/types/api/companyMerges'
import { DismissSuggestionDialog } from './DismissSuggestionDialog'

const SKELETON_ROWS = 3
const FALLBACK_ERROR = '获取会社合并建议失败，请稍后重试'
const NETWORK_ERROR = '网络错误，请检查网络连接后重试'
const DETECT_FALLBACK_ERROR = '检测失败，请稍后重试'

/**
 * Company merge queue. 检测 only scans `patch_company` and writes suggestions;
 * nothing on this page merges or edits a company, so the only actions are
 * detect, refresh and dismiss. Dismissed keys are never revived by a later
 * scan.
 */
export const DashboardCompanyMerges = () => {
  const [items, setItems] = useState<CompanyMergeSuggestion[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [detecting, setDetecting] = useState(false)
  const [refreshNonce, setRefreshNonce] = useState(0)
  const requestSeq = useRef(0)
  const detectInflightRef = useRef(false)
  // 驳回成功后焦点退到这里; 它包住骨架屏/错误/空态/表格四种分支, 永远在 DOM 里。
  const listRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const seq = ++requestSeq.current
    let active = true
    setLoading(true)
    setError(null)
    kunFetchGet<CompanyMergeSuggestionListResponse | string>(
      '/admin/company-merges'
    )
      .then((res) => {
        if (!active || seq !== requestSeq.current) return
        if (typeof res === 'string') {
          setItems(null)
          setError(res.trim() === '' ? FALLBACK_ERROR : res)
          return
        }
        if (res && Array.isArray(res.items)) {
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
      // 失败路径同样要解除 loading, 否则骨架屏会一直挂着
      .finally(() => {
        if (!active || seq !== requestSeq.current) return
        setLoading(false)
      })
    return () => {
      active = false
    }
  }, [refreshNonce])

  const refresh = useCallback(() => setRefreshNonce((nonce) => nonce + 1), [])

  const handleDetect = async () => {
    // 同步锁: await 之前先落 ref 锁, 防止连击重复提交
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
      toast.success(
        `检测完成：新增 ${res.created} 条，更新 ${res.updated} 条，跳过 ${res.skipped} 条`
      )
      refresh()
    } catch {
      toast.error('网络异常，检测结果未知，请刷新列表后核对')
    } finally {
      detectInflightRef.current = false
      setDetecting(false)
    }
  }

  const handleDismissed = useCallback((id: number) => {
    setItems((prev) =>
      prev === null ? prev : prev.filter((item) => item.id !== id)
    )
  }, [])

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
        <p className="text-sm text-muted-foreground">
          没有待处理的会社合并建议
        </p>
        <p className="text-xs text-muted-foreground">
          点「检测」扫描一次会社表
        </p>
      </div>
    ) : (
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>会社</TableHead>
              <TableHead>类型</TableHead>
              <TableHead>折叠键</TableHead>
              <TableHead>检测时间</TableHead>
              <TableHead className="text-right">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((suggestion) => (
              <TableRow key={suggestion.id}>
                <TableCell className="align-top">
                  <div className="flex flex-col gap-1">
                    <span className="flex items-center gap-2 text-sm font-medium">
                      <Badge variant="secondary">目标</Badge>
                      {suggestion.names[0] ?? `#${suggestion.targetCompanyId}`}
                      <span className="text-xs text-muted-foreground">
                        #{suggestion.targetCompanyId}
                      </span>
                    </span>
                    {suggestion.sourceCompanyIds.map((id, index) => (
                      <span
                        key={`${suggestion.id}-source-${id}`}
                        className="flex items-center gap-2 pl-4 text-sm text-muted-foreground"
                      >
                        {suggestion.names[index + 1] ?? `#${id}`}
                        <span className="text-xs">#{id}</span>
                      </span>
                    ))}
                  </div>
                </TableCell>
                <TableCell className="align-top text-sm">
                  {getCompanyMergeSuggestionKindLabel(suggestion.kind)}
                </TableCell>
                <TableCell className="align-top">
                  <code className="rounded bg-muted px-1 text-xs break-all">
                    {suggestion.foldedKey}
                  </code>
                </TableCell>
                <TableCell className="align-top text-sm text-muted-foreground">
                  {formatChinaDateTime(suggestion.detectedAt)}
                </TableCell>
                <TableCell className="text-right align-top">
                  <DismissSuggestionDialog
                    suggestion={suggestion}
                    onDismissed={handleDismissed}
                    fallbackFocusRef={listRef}
                  />
                </TableCell>
              </TableRow>
            ))}
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
        <p className="text-sm text-muted-foreground">
          检测只读取会社表并生成建议，不会合并或修改任何会社。
        </p>
      </div>

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
