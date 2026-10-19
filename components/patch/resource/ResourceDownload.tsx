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
  latestRelinkAt,
  linkHealthForDisplay,
  readLinkHealth,
  readSnapshotId
} from './linkHealthDisplay'
import { useResourceLinkHealthUpdates } from './useResourceLinkHealthUpdates'
import type {
  PatchResource,
  PatchResourceHealthAccessRestoreResponse,
  PatchResourceHealthAccessLink,
  PatchResourceLink
} from '~/types/api/patch'
import type { LinkHealthSummary, LinkHealthView } from '~/types/api/linkHealth'

interface Props {
  resource: PatchResource
  preview?: boolean
  /** Opens the existing resource editor; a link id focuses its address field. */
  onEdit?: (resource: PatchResource, focusLinkId?: number) => void
  /** When the parent owns「遇到问题」, hide the copy on the user/download row. */
  hideReportButton?: boolean
  healthUpdateFor?: (linkId: number) => LinkHealthSummary | null
  /** Report, check, verify and resolve all land in the same page projection. */
  onHealthResult?: (view: LinkHealthView) => void
}

const COLLAPSED_HEIGHT_PX = 96

const restorableLinkId = (link: PatchResourceLink) => Boolean(link.revealed)

type RestoreState = {
  key: string
  links: Map<number, PatchResourceHealthAccessLink>
  expiresAt: string
  error: string
}

export const ResourceDownload = ({
  resource,
  preview = false,
  onEdit,
  hideReportButton = false,
  healthUpdateFor: healthUpdateForProp,
  onHealthResult: onHealthResultProp
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
  const localHealth = useResourceLinkHealthUpdates(resource)
  const healthUpdateFor = healthUpdateForProp ?? localHealth.healthUpdateFor
  const publishHealth = onHealthResultProp ?? localHealth.onReported
  const projectedHealth = (link: PatchResourceLink) =>
    linkHealthForDisplay(link, healthUpdateFor(link.id))
  const brokenLinks = resource.links.filter(
    (link) => projectedHealth(link)?.health === 'broken'
  )
  const brokenFold = brokenLinksFoldText(
    brokenLinks.length,
    latestRelinkAt(
      resource.links.map((link) => {
        const projected = projectedHealth(link)
        return projected ? { ...link, ...projected } : link
      })
    )
  )
  const hasRevealedBroken = resource.links.some(
    (link) =>
      projectedHealth(link)?.health === 'broken' && link.revealed === true
  )
  const brokenKey = brokenLinks.map((link) => link.id).join(',')
  const snapshotId = readSnapshotId(resource)
  const [brokenOpen, setBrokenOpen] = useState(hasRevealedBroken)
  const previousBrokenKey = useRef<string | null>(null)
  const previousSnapshot = useRef(snapshotId)
  useEffect(() => {
    if (previousSnapshot.current !== snapshotId) {
      previousSnapshot.current = snapshotId
      previousBrokenKey.current = brokenKey
      setBrokenOpen(hasRevealedBroken)
      return
    }
    if (previousBrokenKey.current === null) {
      previousBrokenKey.current = brokenKey
      return
    }
    if (previousBrokenKey.current === brokenKey) return
    const previous = new Set(
      previousBrokenKey.current.split(',').filter(Boolean)
    )
    previousBrokenKey.current = brokenKey
    const addedBroken = brokenKey
      .split(',')
      .some((id) => id && !previous.has(id))
    if (addedBroken) setBrokenOpen(false)
  }, [brokenKey, hasRevealedBroken, snapshotId])
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

  const linkIndexMap = useMemo(() => {
    const map = new Map<number, number>()
    resource.links.forEach((link, i) => map.set(link.id, i + 1))
    return map
  }, [resource.links])

  const renderLinkCard = (link: PatchResourceLink) => {
    const restoredLink = currentRestoreState?.links.get(link.id)
    return (
      // id+version 作为子键：版本推进即全新卡片，旧凭据/旧状态不带入
      <ResourceDownloadCard
        key={linkVersionKey(link)}
        resource={resource}
        link={link}
        linkIndex={linkIndexMap.get(link.id) ?? 1}
        preview={preview}
        healthUpdate={healthUpdateFor(link.id)}
        onHealthResult={publishHealth}
        onRelink={onEdit ? (target) => onEdit(resource, target.id) : undefined}
        {...(restoredLink
          ? {
              restoredLink,
              restoredObtainedExpiresAt: currentRestoreState?.expiresAt ?? ''
            }
          : {})}
      />
    )
  }

  return (
    <div className="min-w-0 space-y-2">
      {resource.note ? (
        <div className="w-full">
          <div className="flex flex-col">
            <h3 className="font-medium">
              {resource.name ? resource.name : '资源备注'}
            </h3>
            <p className="text-sm text-default-500">
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

      <div className="flex justify-between">
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

        <div className="flex gap-2">
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
          {!preview && !hideReportButton && (
            <ReportResourceButton
              resource={resource}
              patchId={resource.patchId}
              healthUpdateFor={healthUpdateFor}
              onReported={publishHealth}
            />
          )}
        </div>
      </div>

      {showLinks[resource.id] && (
        <div className="grid min-w-0 gap-2.5">
          {currentRestoreState?.error && (
            <p role="alert" className="text-sm text-danger">
              {currentRestoreState.error}
            </p>
          )}

          {resource.links.map((link) => {
            const broken = projectedHealth(link)?.health === 'broken'
            const collapsed = broken && !brokenOpen
            return (
              <div
                key={link.id}
                hidden={collapsed}
                className={`min-w-0 max-w-full ${broken ? 'order-2' : 'order-1'}`}
              >
                {renderLinkCard(link)}
              </div>
            )
          })}

          {brokenLinks.length > 0 && brokenFold ? (
            <Button
              variant="bordered"
              className="order-1 h-auto justify-start whitespace-normal border-dashed py-2.5 text-left text-sm text-default-500"
              aria-expanded={brokenOpen}
              onPress={() => setBrokenOpen((open) => !open)}
            >
              {brokenFold}
              {brokenOpen ? '' : ' · 已折叠'}
            </Button>
          ) : null}
        </div>
      )}
    </div>
  )
}
