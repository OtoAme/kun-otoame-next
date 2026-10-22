'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Button } from '~/components/dashboard/ui/button'
import { Input } from '~/components/dashboard/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '~/components/dashboard/ui/select'
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger
} from '~/components/dashboard/ui/tabs'
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
import { kunFetchGet } from '~/utils/kunFetch'
import { WorkspaceMaintenance } from './WorkspaceMaintenance'
import { WorkspaceResourceCard } from './WorkspaceResourceCard'
import { workspaceActionError } from './WorkspaceShell'

const STATUS_LABEL: Record<WorkspaceResourceStatus, string> = {
  all: '全部状态',
  normal: '正常',
  pending: '待审核',
  banned: '已封禁'
}

export function WorkspaceResources() {
  return (
    <Tabs defaultValue="resources" className="min-w-0 gap-4">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">我的资源</h1>
        <p className="text-sm text-muted-foreground">
          正常资源可以编辑。待审核和封禁的资源只读，不提供凭据。新资源仍在游戏页面发布。
        </p>
      </div>
      <TabsList>
        <TabsTrigger value="resources">资源列表</TabsTrigger>
        <TabsTrigger value="maintenance">链接维护</TabsTrigger>
      </TabsList>
      <TabsContent
        value="resources"
        forceMount
        className="data-[state=inactive]:hidden"
      >
        <WorkspaceResourceList />
      </TabsContent>
      <TabsContent
        value="maintenance"
        forceMount
        className="data-[state=inactive]:hidden"
      >
        <WorkspaceMaintenance />
      </TabsContent>
    </Tabs>
  )
}

function WorkspaceResourceList() {
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
    } catch (error) {
      if (generation !== generationRef.current) return
      setError(workspaceActionError(error, '网络错误，列表加载失败，请重试'))
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
    <div className="min-w-0 space-y-4">
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
        <div className="flex items-center gap-2 text-sm">
          <span id="workspace-resource-status-label">状态</span>
          <Select
            value={status}
            onValueChange={(value) => {
              setStatus(value as WorkspaceResourceStatus)
              setPage(1)
            }}
          >
            <SelectTrigger
              aria-labelledby="workspace-resource-status-label"
              className="w-32"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {WORKSPACE_RESOURCE_STATUSES.map((value) => (
                <SelectItem key={value} value={value}>
                  {STATUS_LABEL[value]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center gap-2 text-sm">
          <span id="workspace-resource-section-label">分区</span>
          <Select
            value={section}
            onValueChange={(value) => {
              setSection(value as WorkspaceSection)
              setPage(1)
            }}
          >
            <SelectTrigger
              aria-labelledby="workspace-resource-section-label"
              className="w-32"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {WORKSPACE_SECTIONS.map((value) => (
                <SelectItem key={value} value={value}>
                  {value === 'all' ? '全部分区' : RESOURCE_SECTION_MAP[value]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button type="submit" size="sm" variant="outline">
          搜索
        </Button>
      </form>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      {!error && loading && !data ? (
        <p className="text-sm">正在加载资源…</p>
      ) : null}
      {!error && data && data.items.length === 0 ? (
        <p className="text-sm text-muted-foreground">没有符合条件的资源。</p>
      ) : null}
      {!error ? (
        <ul className="grid min-w-0 gap-3">
          {(data?.items ?? []).map((item) => (
            <li key={item.id} className="min-w-0">
              <WorkspaceResourceCard item={item} />
            </li>
          ))}
        </ul>
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
    </div>
  )
}
