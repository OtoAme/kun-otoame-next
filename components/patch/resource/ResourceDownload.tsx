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
import { markdownToHtml } from './kun/markdownToHtml'
import type {
  PatchResource,
  PatchResourceAccessLink,
  PatchResourceAccessRestoreResponse
} from '~/types/api/patch'

interface Props {
  resource: PatchResource
}

const COLLAPSED_HEIGHT_PX = 96

type RestoreState = {
  key: string
  links: Map<number, PatchResourceAccessLink>
  expiresAt: string
  error: string
}

export const ResourceDownload = ({ resource }: Props) => {
  const [showLinks, setShowLinks] = useState<Record<number, boolean>>(() =>
    resource.links.some((link) => link.revealed) ? { [resource.id]: true } : {}
  )
  const revealedLinkIds = useMemo(
    () =>
      [
        ...new Set(
          resource.links.filter((link) => link.revealed).map((link) => link.id)
        )
      ].sort((left, right) => left - right),
    [resource.links]
  )
  const restoreKey = `${resource.patchId}:${resource.id}:${revealedLinkIds.join(',')}`
  const restoreRequestRef = useRef<{
    key: string
    promise: Promise<PatchResourceAccessRestoreResponse | string>
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
    if (revealedLinkIds.length === 0) {
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
        promise: kunFetchPost<PatchResourceAccessRestoreResponse | string>(
          '/patch/resource/download/access/restore',
          {
            patchId: resource.patchId,
            resourceId: resource.id,
            linkIds: revealedLinkIds
          }
        )
      }
    }

    let stale = false
    const request = restoreRequestRef.current
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
      })

    return () => {
      stale = true
    }
  }, [restoreKey, resource.id, resource.patchId, revealedLinkIds])

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
          <ResourceLikeButton resource={resource} />
          <Button
            color="primary"
            isIconOnly
            aria-label={`下载 OtomeGame 资源`}
            onPress={() => toggleLinks(resource.id)}
          >
            <Download className="size-4" />
          </Button>
        </div>
      </div>

      {showLinks[resource.id] && (
        <div className="space-y-3">
          {currentRestoreState?.error && (
            <p role="alert" className="text-sm text-danger">
              {currentRestoreState.error}
            </p>
          )}

          {resource.links.map((link) => {
            const restoredLink = currentRestoreState?.links.get(link.id)
            return (
              <ResourceDownloadCard
                key={link.id}
                resource={resource}
                link={link}
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
