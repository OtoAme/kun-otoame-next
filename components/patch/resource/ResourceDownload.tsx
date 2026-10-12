'use client'

import DOMPurify from 'isomorphic-dompurify'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Button } from '@heroui/react'
import { KunUser } from '~/components/kun/floating-card/KunUser'
import { ChevronDown, ChevronUp, Download } from 'lucide-react'
import { formatTimeDifference } from '~/utils/time'
import { kunFetchPost } from '~/utils/kunFetch'
import { ResourceLikeButton } from './ResourceLike'
import { ResourceDownloadCard } from './DownloadCard'
import { ReportResourceButton } from '~/components/case/ReportResourceButton'
import { markdownToHtml } from './kun/markdownToHtml'
import {
  brokenLinksFoldText,
  countBrokenLinks,
  latestRelinkAt,
  readLinkHealth,
  readSnapshotId
} from './linkHealthDisplay'
import type {
  PatchResource,
  PatchResourceHealthAccessRestoreResponse,
  PatchResourceHealthAccessLink,
  PatchResourceLink
} from '~/types/api/patch'
import type { LinkHealthSummary } from '~/types/api/linkHealth'

interface Props {
  resource: PatchResource
  preview?: boolean
  /** Opens the existing resource editor; a link id focuses its address field. */
  onEdit?: (resource: PatchResource, focusLinkId?: number) => void
}

const COLLAPSED_HEIGHT_PX = 96

// 已失效链接不提供获取入口，也不参与已获取恢复（E04-04）。
const restorableLinkId = (link: PatchResourceLink) =>
  link.revealed && readLinkHealth(link)?.health !== 'broken'

type RestoreState = {
  key: string
  links: Map<number, PatchResourceHealthAccessLink>
  expiresAt: string
  error: string
}

export const ResourceDownload = ({
  resource,
  preview = false,
  onEdit
}: Props) => {
  const [showLinks, setShowLinks] = useState<Record<number, boolean>>(() =>
    preview || resource.links.some((link) => link.revealed)
      ? { [resource.id]: true }
      : {}
  )
  // 凭据标识 = 目标 + 当前读取快照版本：补链或换版本必然换身份并重新恢复
  const revealedLinks = useMemo(
    () =>
      resource.links
        .filter(restorableLinkId)
        .map((link) => ({
          id: link.id,
          version: readLinkHealth(link)?.version ?? null
        }))
        .sort((left, right) => left.id - right.id),
    [resource.links]
  )
  const revealedLinkIds = useMemo(
    () => revealedLinks.map((entry) => entry.id),
    [revealedLinks]
  )
  const brokenFold = brokenLinksFoldText(
    countBrokenLinks(resource.links),
    latestRelinkAt(resource.links)
  )
  // 「遇到问题」报告结果按链接下发到对应卡片的事实展示。每条更新都带上
  // 捕获时的读取快照标记：迟到的旧快照回调即使闯过清理窗口也不被渲染；
  // 新快照（对象引用变化）同时清空旧表并回到服务端事实
  const [healthUpdates, setHealthUpdates] = useState<
    Record<number, { view: LinkHealthSummary; snapshotId: number }>
  >({})
  useEffect(() => {
    setHealthUpdates({})
  }, [resource])
  const snapshotId = readSnapshotId(resource)
  // 渲染即更新的当前快照引用：旧快照闭包的迟到回调整笔丢弃，不覆盖
  // 同 linkId 已收到的新快照成功结果
  const currentSnapshotRef = useRef(snapshotId)
  currentSnapshotRef.current = snapshotId
  const healthUpdateFor = (linkId: number): LinkHealthSummary | null => {
    const entry = healthUpdates[linkId]
    return entry && entry.snapshotId === snapshotId ? entry.view : null
  }
  const restoreKey = `${resource.patchId}:${resource.id}:${readSnapshotId(resource)}:${revealedLinks
    .map((entry) => `${entry.id}:${entry.version ?? 'na'}`)
    .join(',')}`
  const linkVersionKey = (link: PatchResourceLink): string =>
    `${link.id}:${readLinkHealth(link)?.version ?? 'na'}`
  const restoreRequestRef = useRef<{
    key: string
    promise: Promise<PatchResourceHealthAccessRestoreResponse | string>
  } | null>(null)
  const [restoreState, setRestoreState] = useState<RestoreState>({
    key: '',
    links: new Map(),
    expiresAt: '',
    error: ''
  })
  const currentRestoreState =
    restoreState.key === restoreKey ? restoreState : null

  const [note, setNote] = useState('')
  const [isNoteExpanded, setIsNoteExpanded] = useState(false)
  const [isNoteOverflowing, setIsNoteOverflowing] = useState(false)
  const noteContentRef = useRef<HTMLDivElement>(null)

  const toggleLinks = (resourceId: number) => {
    setShowLinks((prev) => ({
      ...prev,
      [resourceId]: !prev[resourceId]
    }))
  }

  const getResourceNoteHtml = async () => {
    const html = await markdownToHtml(resource.note)
    const safeHtml = DOMPurify.sanitize(html)
    setNote(safeHtml)
  }

  useEffect(() => {
    getResourceNoteHtml()
  }, [])

  useEffect(() => {
    if (preview || revealedLinkIds.length === 0) {
      restoreRequestRef.current = null
      setRestoreState({
        key: restoreKey,
        links: new Map(),
        expiresAt: '',
        error: ''
      })
      return
    }

    setShowLinks((current) => ({ ...current, [resource.id]: true }))
    if (restoreRequestRef.current?.key !== restoreKey) {
      setRestoreState({
        key: restoreKey,
        links: new Map(),
        expiresAt: '',
        error: ''
      })
      restoreRequestRef.current = {
        key: restoreKey,
        promise: kunFetchPost<
          PatchResourceHealthAccessRestoreResponse | string
        >('/patch/resource/download/access/restore', {
          patchId: resource.patchId,
          resourceId: resource.id,
          linkIds: revealedLinkIds
        })
      }
    }

    let stale = false
    const request = restoreRequestRef.current
    // 只去重真正相同的 in-flight：完成即释放，下一身份或父级刷新都重新读取
    const releaseCompletedRequest = () => {
      if (restoreRequestRef.current === request) {
        restoreRequestRef.current = null
      }
    }
    void request.promise
      .then((response) => {
        if (stale || restoreRequestRef.current?.key !== restoreKey) return
        if (typeof response === 'string') {
          setRestoreState({
            key: restoreKey,
            links: new Map(),
            expiresAt: '',
            error: '已获取链接恢复失败，可点击单条链接重试'
          })
          releaseCompletedRequest()
          return
        }

        const requestedIds = new Set(revealedLinkIds)
        setRestoreState({
          key: restoreKey,
          links: new Map(
            response.links
              .filter((link) => requestedIds.has(link.id))
              .map((link) => [link.id, link])
          ),
          expiresAt: response.obtainedExpiresAt ?? '',
          error: ''
        })
        releaseCompletedRequest()
      })
      .catch(() => {
        if (!stale && restoreRequestRef.current?.key === restoreKey) {
          setRestoreState({
            key: restoreKey,
            links: new Map(),
            expiresAt: '',
            error: '已获取链接恢复失败，可点击单条链接重试'
          })
        }
        releaseCompletedRequest()
      })

    return () => {
      stale = true
    }
  }, [preview, restoreKey, resource.id, resource.patchId, revealedLinkIds])

  useLayoutEffect(() => {
    const element = noteContentRef.current
    if (element) {
      if (element.scrollHeight > COLLAPSED_HEIGHT_PX) {
        setIsNoteOverflowing(true)
      } else {
        setIsNoteOverflowing(false)
      }
    }
  }, [note])

  return (
    <div className="space-y-2">
      {resource.note ? (
        <div className="w-full">
          <div className="flex flex-col">
            <h3 className="font-medium">
              {resource.name ? resource.name : '资源备注'}
            </h3>
            <p className="text-sm text-default-5000">
              该补丁资源创建于 {formatTimeDifference(resource.created)}
            </p>
          </div>

          <div className="relative mt-2">
            <div
              ref={noteContentRef}
              className={`kun-prose max-w-none overflow-hidden transition-all duration-300 ease-in-out`}
              style={{
                maxHeight: isNoteExpanded ? '' : `${COLLAPSED_HEIGHT_PX}px`
              }}
            >
              <div
                dangerouslySetInnerHTML={{
                  __html: note
                }}
              />
            </div>

            {isNoteOverflowing && !isNoteExpanded && (
              <div className="absolute bottom-0 left-0 w-full h-12 bg-gradient-to-t from-content1 to-transparent" />
            )}
          </div>

          {isNoteOverflowing && (
            <Button
              variant="light"
              color="primary"
              className="px-2 py-1 mt-1 text-sm"
              onPress={() => setIsNoteExpanded(!isNoteExpanded)}
            >
              {isNoteExpanded ? (
                <>
                  <ChevronUp className="mr-1 size-4" />
                  收起备注
                </>
              ) : (
                <>
                  <ChevronDown className="mr-1 size-4" />
                  展开全部备注
                </>
              )}
            </Button>
          )}
        </div>
      ) : (
        <p>{resource.name}</p>
      )}

      {/* 用户与操作一行装不下的窄屏自然换行：用户名可收缩，动作仍可完整右落；桌面仍紧凑同行 */}
      <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
        <div className="min-w-0 max-w-full shrink">
          <KunUser
            user={resource.user}
            userProps={{
              name: resource.user.name,
              description: `${formatTimeDifference(resource.created)} • 已发布资源 ${resource.user.patchCount} 个`,
              avatarProps: {
                showFallback: true,
                src: resource.user.avatar,
                name: resource.user.name.charAt(0).toUpperCase()
              }
            }}
          />
        </div>

        <div className="flex flex-wrap gap-2">
          {preview ? (
            <span className="self-center text-sm" aria-label="点赞数">
              {resource.likeCount}
            </span>
          ) : (
            <ResourceLikeButton resource={resource} />
          )}
          <Button
            color="primary"
            isIconOnly
            aria-label={`下载 OtomeGame 资源`}
            onPress={() => toggleLinks(resource.id)}
          >
            <Download className="size-4" />
          </Button>
          {!preview && (
            <ReportResourceButton
              resource={resource}
              patchId={resource.patchId}
              onReported={(view) => {
                // 旧快照闭包的迟到回调整笔 no-op，保留已收到的新匹配更新
                if (snapshotId !== currentSnapshotRef.current) {
                  return
                }
                setHealthUpdates((current) => ({
                  ...current,
                  [view.linkId]: { view, snapshotId }
                }))
              }}
            />
          )}
        </div>
      </div>

      {showLinks[resource.id] && (
        <div className="space-y-3">
          {brokenFold && (
            <p className="text-sm text-default-500" role="status">
              {brokenFold}
            </p>
          )}

          {currentRestoreState?.error && (
            <p role="alert" className="text-sm text-danger">
              {currentRestoreState.error}
            </p>
          )}

          {resource.links.map((link) => {
            const restoredLink =
              readLinkHealth(link)?.health === 'broken'
                ? undefined
                : currentRestoreState?.links.get(link.id)
            return (
              // id+version 作为子键：版本推进即全新卡片，旧凭据/旧状态不带入
              <ResourceDownloadCard
                key={linkVersionKey(link)}
                resource={resource}
                link={link}
                preview={preview}
                healthUpdate={healthUpdateFor(link.id)}
                onRelink={
                  onEdit ? (target) => onEdit(resource, target.id) : undefined
                }
                {...(restoredLink
                  ? {
                      restoredLink,
                      restoredObtainedExpiresAt:
                        currentRestoreState?.expiresAt ?? ''
                    }
                  : {})}
              />
            )
          })}
        </div>
      )}
    </div>
  )
}
