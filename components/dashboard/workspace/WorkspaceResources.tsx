'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { Badge } from '~/components/dashboard/ui/badge'
import { Button } from '~/components/dashboard/ui/button'
import { Card, CardContent } from '~/components/dashboard/ui/card'
import { Input } from '~/components/dashboard/ui/input'
import {
  WORKSPACE_PAGE_LIMIT,
  WORKSPACE_RESOURCE_STATUSES,
  WORKSPACE_SECTIONS
} from '~/constants/workspace'
import { RESOURCE_SECTION_MAP } from '~/constants/resource'
import type {
  WorkspaceResourceStatus,
  WorkspaceResourcesResponse,
  WorkspaceSection
} from '~/types/api/workspace'
import { workspaceResourceHref } from '~/utils/workspaceRoutes'
import { kunFetchGet } from '~/utils/kunFetch'
import { WorkspaceMaintenance } from './WorkspaceMaintenance'

const resourceStatusLabel = (status: number) => {
  if (status === 0) return '正常'
  if (status === 2) return '待审核'
  if (status === 1) return '已隐藏'
  return `状态 ${status}`
}

const STATUS_LABEL: Record<WorkspaceResourceStatus, string> = {
  all: '全部状态',
  normal: '正常',
  pending: '待审核',
  banned: '已封禁'
}

export function WorkspaceResources() {
  const [query, setQuery] = useState('')
  const [submittedQuery, setSubmittedQuery] = useState('')
  const [status, setStatus] = useState<WorkspaceResourceStatus>('all')
  const [section, setSection] = useState<WorkspaceSection>('all')
  const [page, setPage] = useState(1)
  const [data, setData] = useState<WorkspaceResourcesResponse | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const generationRef = useRef(0)

  const load = useCallback(async () => {
    const generation = ++generationRef.current
    setLoading(true)
    setError('')
    try {
      const response = await kunFetchGet<WorkspaceResourcesResponse | string>(
        '/workspace/resources',
        {
          page,
          limit: WORKSPACE_PAGE_LIMIT,
          status,
          section,
          ...(submittedQuery ? { query: submittedQuery } : {})
        }
      )
      if (generation !== generationRef.current) return
      if (typeof response === 'string') {
        setError(response || '加载资源失败')
        return
      }
      setData(response)
    } catch {
      if (generation !== generationRef.current) return
      setError('网络错误，列表加载失败，请重试')
    } finally {
      if (generation === generationRef.current) setLoading(false)
    }
  }, [page, section, status, submittedQuery])

  useEffect(() => {
    void load()
  }, [load])

  const pages = Math.max(
    1,
    Math.ceil((data?.total ?? 0) / (data?.limit ?? WORKSPACE_PAGE_LIMIT))
  )

  return (
    <div className="min-w-0 space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">我的资源</h1>
        <p className="text-sm text-muted-foreground">
          正常资源可以编辑。待审核和封禁的资源只读，不提供凭据。新资源仍在游戏页面发布。
        </p>
      </div>
      <form
        className="flex min-w-0 flex-wrap items-end gap-2"
        onSubmit={(event) => {
          event.preventDefault()
          setPage(1)
          setSubmittedQuery(query.trim())
        }}
      >
        <Input
          aria-label="搜索资源或游戏"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="资源名或游戏名"
          className="min-w-0 w-full sm:w-64"
        />
        <label className="flex items-center gap-2 text-sm">
          状态
          <select
            aria-label="资源状态"
            className="h-9 rounded-md border bg-background px-2"
            value={status}
            onChange={(event) => {
              setStatus(event.target.value as WorkspaceResourceStatus)
              setPage(1)
            }}
          >
            {WORKSPACE_RESOURCE_STATUSES.map((value) => (
              <option key={value} value={value}>
                {STATUS_LABEL[value]}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2 text-sm">
          分区
          <select
            aria-label="资源分区"
            className="h-9 rounded-md border bg-background px-2"
            value={section}
            onChange={(event) => {
              setSection(event.target.value as WorkspaceSection)
              setPage(1)
            }}
          >
            {WORKSPACE_SECTIONS.map((value) => (
              <option key={value} value={value}>
                {value === 'all' ? '全部分区' : RESOURCE_SECTION_MAP[value]}
              </option>
            ))}
          </select>
        </label>
        <Button type="submit" size="sm" variant="outline">
          搜索
        </Button>
      </form>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      {loading && !data ? <p className="text-sm">正在加载资源…</p> : null}
      <ul className="grid min-w-0 gap-3">
        {(data?.items ?? []).map((item) => (
          <li key={item.id} className="min-w-0">
            <Card>
              <CardContent className="flex min-w-0 flex-wrap items-center justify-between gap-3 pt-4">
                <div className="min-w-0 space-y-1">
                  <h2 className="break-all font-medium">
                    {item.name || '未命名资源'}
                  </h2>
                  <p className="break-all text-sm text-muted-foreground">
                    {item.patchName} ·{' '}
                    {RESOURCE_SECTION_MAP[item.section] ?? item.section} ·{' '}
                    {item.linkCount} 条链接
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {item.actionableCount > 0 ? (
                    <Badge>{item.actionableCount} 条待处理</Badge>
                  ) : null}
                  <Badge variant="secondary">
                    {resourceStatusLabel(item.status)}
                  </Badge>
                  <Button asChild size="sm" variant="outline">
                    <Link href={workspaceResourceHref(item.id)}>
                      {item.capabilities.canEdit ? '编辑' : '查看'}
                    </Link>
                  </Button>
                </div>
              </CardContent>
            </Card>
          </li>
        ))}
      </ul>
      {data && data.items.length === 0 ? (
        <p className="text-sm text-muted-foreground">没有符合条件的资源。</p>
      ) : null}
      {pages > 1 ? (
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={page <= 1}
            onClick={() => setPage((current) => current - 1)}
          >
            上一页
          </Button>
          <span className="text-sm text-muted-foreground">
            {page} / {pages}
          </span>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={page >= pages}
            onClick={() => setPage((current) => current + 1)}
          >
            下一页
          </Button>
        </div>
      ) : null}
      <WorkspaceMaintenance />
    </div>
  )
}
