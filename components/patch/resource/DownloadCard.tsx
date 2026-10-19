'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Snippet } from '@heroui/snippet'
import {
  Button,
  Card,
  CardBody,
  Modal,
  ModalBody,
  ModalContent,
  ModalHeader,
  useDisclosure
} from '@heroui/react'
import { Tooltip } from '@heroui/tooltip'
import { Flag, Link as LinkIcon } from 'lucide-react'
import toast from 'react-hot-toast'
import { LINK_HEALTH_ERRORS } from '~/constants/linkHealth'
import { SUPPORTED_RESOURCE_LINK_MAP } from '~/constants/resource'
import { kunFetchPost, kunFetchPut } from '~/utils/kunFetch'
import { KunExternalLink } from '~/components/kun/external-link/ExternalLink'
import {
  isHealthAtLeast,
  LINK_HEALTH_LABELS,
  maintenanceSnoozeExpired,
  mergeHealthProjection,
  readLinkHealth,
  readSnapshotId
} from './linkHealthDisplay'
import { requestExpiredHealthReread } from './useResourceLinkHealthUpdates'
import { LinkHealthDot } from './LinkHealthDot'
import { LinkReportPanel } from './LinkReportPanel'
import { LinkHealthActions } from './LinkHealthActions'
import { NetdiskChip } from './NetdiskChip'
import { resolveDisplayedDiskKind } from '~/utils/resourceDiskKind'
import { CaseLoginPrompt } from '~/components/case/CaseLoginPrompt'
import type {
  PatchResource,
  PatchResourceAccessLink,
  PatchResourceHealthAccessLink,
  PatchResourceHealthAccessResponse,
  PatchResourceLink,
  ResourceAccessQuota
} from '~/types/api/patch'
import type { LinkHealthSummary, LinkHealthView } from '~/types/api/linkHealth'

const displayBlack3Hash = (hash: string) => hash.replace(/^b3:/i, '')

const wrapLongTextClass =
  'min-w-0 max-w-full break-all [overflow-wrap:anywhere]'
// HeroUI Snippet `pre` is whitespace-nowrap; important wrap beats the theme slot.
const credentialSnippetClassNames = {
  base: 'min-w-0 max-w-full',
  pre: `${wrapLongTextClass} !whitespace-pre-wrap`
}

/** 版本存在时的凭据/请求匹配：旧版本请求、迟到响应与恢复结果一律丢弃。 */
const versionMatches = (
  currentVersion: number | null,
  candidateVersion: number | null | undefined
): boolean =>
  currentVersion === null ? true : candidateVersion === currentVersion

interface Props {
  resource: PatchResource
  link: PatchResourceLink
  /** 从 1 开始的链接序号，用于显示「链接 #N」。 */
  linkIndex?: number
  restoredLink?: PatchResourceAccessLink
  restoredObtainedExpiresAt?: string
  preview?: boolean
  /** 补链：打开既有资源编辑并把表单定位到这条链接的地址栏。 */
  onRelink?: (link: PatchResourceLink) => void
  /** 父级健康更新（两步对话框的报告结果），按版本/轮次有序合并。 */
  healthUpdate?: LinkHealthSummary | null
  /** Bubbles report/check/verify/resolve into the page projection. */
  onHealthResult?: (view: LinkHealthView) => void
}

export const ResourceDownloadCard = ({
  resource,
  link,
  linkIndex = 1,
  restoredLink,
  restoredObtainedExpiresAt,
  preview = false,
  onRelink,
  healthUpdate = null,
  onHealthResult
}: Props) => {
  const [manualAccess, setManualAccess] = useState<{
    link: PatchResourceHealthAccessLink
    obtainedExpiresAt: string
    resourceId: number
    linkId: number
    version: number
    snapshotId: number
  } | null>(null)
  const [quota, setQuota] = useState<ResourceAccessQuota | null>(null)
  const [accessing, setAccessing] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')
  // 动作/报告结果的本地投影，附带来源读取快照：只有同一快照内有效
  const [healthOverride, setHealthOverride] = useState<{
    view: LinkHealthSummary
    snapshotId: number
  } | null>(null)
  const report = useDisclosure()
  const login = useDisclosure()
  // 目标/版本/读取快照代际：过一次代际的迟到响应不得写回状态
  const mountedRef = useRef(true)
  const generationRef = useRef(0)

  const serverHealth = readLinkHealth(link)
  const linkVersion = serverHealth?.version ?? null
  const snapshotId = readSnapshotId(resource)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  // 换目标、换版本或换读取快照：丢掉上一代的凭据与本地覆盖，回到服务端事实
  useEffect(() => {
    generationRef.current += 1
    setManualAccess(null)
    setHealthOverride(null)
    setQuota(null)
    setErrorMessage('')
    setAccessing(false)
  }, [link.id, linkVersion, snapshotId])

  // 服务端快照追上或超过本地覆盖：弃用覆盖（同快照内按版本/轮次有序）
  useEffect(() => {
    if (!serverHealth) return
    setHealthOverride((current) =>
      current && !isHealthAtLeast(current.view, serverHealth) ? null : current
    )
  }, [serverHealth])

  // 单一当前有效投影：服务端快照 → 父级更新 → 本快照内动作结果，新者胜
  const health = useMemo(() => {
    const withParent = mergeHealthProjection(serverHealth, healthUpdate)
    const currentOverride =
      healthOverride && healthOverride.snapshotId === snapshotId
        ? healthOverride.view
        : null
    return mergeHealthProjection(withParent, currentOverride)
  }, [serverHealth, healthUpdate, healthOverride, snapshotId])

  // 本快照内发起的动作/报告结果：记录来源快照；换快照后来源响应被丢弃
  const applyHealthRef = useRef<(view: LinkHealthSummary) => void>(() => {})
  const appliedReread = useRef(new Set<string>())
  const expiredResume =
    health?.maintenance?.restriction === 'snoozed'
      ? health.maintenance.resumesAt
      : null

  useEffect(() => {
    if (
      !health ||
      !expiredResume ||
      !maintenanceSnoozeExpired(health.maintenance)
    ) {
      return
    }
    const origin = snapshotId
    const version = health.version
    const linkId = link.id
    const attempt = `${origin}@${linkId}@${version}@${expiredResume}`
    if (appliedReread.current.has(attempt)) return
    appliedReread.current.add(attempt)
    const resourceObject = resource
    void requestExpiredHealthReread({
      patchId: resourceObject.patchId,
      resourceId: resourceObject.id,
      linkId,
      version,
      resumesAt: expiredResume,
      snapshotId: origin,
      stillOrigin: () => readSnapshotId(resourceObject) === origin
    }).then((view) => {
      if (!view || readSnapshotId(resourceObject) !== origin) return
      if (
        view.patchId !== resourceObject.patchId ||
        view.resourceId !== resourceObject.id ||
        view.linkId !== linkId ||
        view.version !== version
      ) {
        return
      }
      applyHealthRef.current(view)
    })
  }, [expiredResume, health, link.id, resource, snapshotId])

  const applyLocalHealthResult = (view: LinkHealthSummary) => {
    setHealthOverride((current) => {
      const previous =
        current && current.snapshotId === snapshotId ? current.view : null
      const merged = mergeHealthProjection(
        mergeHealthProjection(serverHealth, previous),
        view
      )
      return merged ? { view: merged, snapshotId } : current
    })
    const candidate = view as LinkHealthView
    if (
      typeof candidate.patchId === 'number' &&
      typeof candidate.resourceId === 'number' &&
      typeof candidate.linkId === 'number'
    ) {
      onHealthResult?.(candidate)
    }
  }
  applyHealthRef.current = applyLocalHealthResult

  const restoredAccessedLink =
    restoredLink?.id === link.id &&
    versionMatches(
      linkVersion,
      (restoredLink as PatchResourceHealthAccessLink).version ?? null
    )
      ? restoredLink
      : null
  const previewLink: PatchResourceAccessLink | null =
    preview && link.content
      ? {
          id: link.id,
          storage: link.storage,
          size: link.size,
          content: link.content,
          code: link.code ?? '',
          password: link.password ?? '',
          hash: ''
        }
      : null
  const matchedManual =
    manualAccess &&
    manualAccess.resourceId === resource.id &&
    manualAccess.linkId === link.id &&
    manualAccess.snapshotId === snapshotId &&
    versionMatches(linkVersion, manualAccess.version)
      ? manualAccess
      : null
  const accessedLink = preview
    ? previewLink
    : (matchedManual?.link ?? restoredAccessedLink)
  const obtainedExpiresAt =
    matchedManual?.obtainedExpiresAt ||
    (restoredAccessedLink ? (restoredObtainedExpiresAt ?? '') : '') ||
    link.obtainedExpiresAt ||
    ''
  const handleClickDownload = async () => {
    if (preview) return
    await kunFetchPut<KunResponse<{}>>('/patch/resource/download', {
      patchId: resource.patchId,
      resourceId: resource.id,
      linkId: link.id
    })
  }

  const handleAccessLink = async () => {
    if (preview) return
    const generation = generationRef.current
    const requestVersion = linkVersion
    const requestSnapshotId = snapshotId
    const requestResourceId = resource.id
    const requestLinkId = link.id
    setAccessing(true)
    setErrorMessage('')

    try {
      const response = await kunFetchPost<
        PatchResourceHealthAccessResponse | string
      >('/patch/resource/download/access', {
        patchId: resource.patchId,
        resourceId: resource.id,
        linkId: link.id
      })

      // 迟到/过期代际响应：组件已切目标或已换版本，丢弃
      if (!mountedRef.current || generation !== generationRef.current) {
        return
      }
      if (typeof response === 'string') {
        setErrorMessage(response)
        toast.error(response)
        return
      }
      if (!versionMatches(requestVersion, response.link.version)) {
        const message = LINK_HEALTH_ERRORS.version_conflict.message
        setErrorMessage(message)
        toast.error(message)
        return
      }

      setManualAccess({
        link: response.link,
        obtainedExpiresAt: response.access.obtainedExpiresAt,
        resourceId: requestResourceId,
        linkId: requestLinkId,
        version: response.link.version,
        snapshotId: requestSnapshotId
      })
      setQuota(
        response.access.kind === 'resource_granted' && response.quota
          ? response.quota
          : null
      )
    } catch {
      if (mountedRef.current && generation === generationRef.current) {
        const message = '获取下载链接失败，请稍后重试'
        setErrorMessage(message)
        toast.error(message)
      }
    } finally {
      if (mountedRef.current && generation === generationRef.current) {
        setAccessing(false)
      }
    }
  }

  const renderHash = (hash: string) =>
    link.storage === 's3' && hash ? (
      <div className="space-y-1">
        <p className="text-sm">
          BLACK3 校验码 (您可以根据此校验码校验下载文件完整性)
        </p>
        <Snippet
          symbol=""
          className="flex min-w-0 max-w-full overflow-auto whitespace-normal"
          classNames={credentialSnippetClassNames}
        >
          {displayBlack3Hash(hash)}
        </Snippet>
      </div>
    ) : null

  const accessButtonText =
    link.revealed === true ? '查看已获取链接' : '获取下载链接'

  const healthMutationProps = health
    ? {
        patchId: resource.patchId,
        resourceId: resource.id,
        link: health
      }
    : null
  const diskKind = resolveDisplayedDiskKind({
    storage: link.storage,
    content: accessedLink?.content || link.content,
    diskKind: link.diskKind,
    healthProvider: health?.latestCheck?.provider
  })
  const healthMeta = health
    ? [LINK_HEALTH_LABELS[health.health], link.size].filter(Boolean).join(' · ')
    : link.size
  const showReport = Boolean(!preview && health && accessedLink)
  const linkLabel = `链接 #${linkIndex}`

  const credentials = accessedLink ? (
    <Card
      shadow="none"
      radius="lg"
      className="min-w-0 max-w-full overflow-visible border border-default-200 bg-content1"
    >
      <CardBody className="min-w-0 max-w-full gap-2 overflow-visible p-3">
        <div className="min-w-0 max-w-full">
          <KunExternalLink
            className={`inline-flex ${wrapLongTextClass} w-fit`}
            onPress={handleClickDownload}
            underline="always"
            link={accessedLink.content}
          >
            <span className={wrapLongTextClass}>{accessedLink.content}</span>
          </KunExternalLink>
        </div>

        {(accessedLink.code || accessedLink.password) && (
          <div className="flex min-w-0 max-w-full flex-wrap gap-2">
            {accessedLink.code && (
              <Snippet
                tooltipProps={{
                  content: '点击复制提取码'
                }}
                size="sm"
                symbol="提取码"
                color="primary"
                className="min-w-0 max-w-full py-0"
                classNames={credentialSnippetClassNames}
              >
                {accessedLink.code}
              </Snippet>
            )}

            {accessedLink.password && (
              <Snippet
                tooltipProps={{
                  content: '点击复制解压码'
                }}
                size="sm"
                symbol="解压码"
                color="primary"
                className="min-w-0 max-w-full py-0"
                classNames={credentialSnippetClassNames}
              >
                {accessedLink.password}
              </Snippet>
            )}
          </div>
        )}

        {renderHash(accessedLink.hash ?? '')}
      </CardBody>
    </Card>
  ) : preview ? (
    <p className="text-sm text-default-500">该链接暂无可预览的地址</p>
  ) : (
    <>
      <Button
        color="primary"
        className="w-fit"
        isLoading={accessing}
        isDisabled={accessing}
        startContent={!accessing ? <LinkIcon className="size-4" /> : null}
        onPress={handleAccessLink}
      >
        {accessButtonText}
      </Button>

      {errorMessage && (
        <p role="alert" className="text-sm text-danger">
          {errorMessage}
        </p>
      )}

      {renderHash(link.hash)}
    </>
  )

  const healthActionProps =
    !preview && healthMutationProps
      ? {
          ...healthMutationProps,
          onRelink: onRelink ? () => onRelink(link) : undefined,
          onChanged: applyLocalHealthResult
        }
      : null

  return (
    <Card
      shadow="none"
      radius="lg"
      className="min-w-0 max-w-full overflow-visible border border-default-200 bg-default-50"
    >
      <CardBody className="min-w-0 max-w-full gap-2.5 overflow-visible p-3">
        <div className="flex items-center gap-x-2.5 gap-y-1">
          <div className="flex min-w-0 flex-wrap items-center gap-1.5">
            <div className="font-semibold">{linkLabel}</div>
            <NetdiskChip kind={diskKind} />
            {healthMeta ? (
              <div
                className="flex items-center gap-1.5 text-xs font-normal leading-4 text-default-500"
                aria-label="链接状态"
              >
                {health ? <LinkHealthDot link={health} /> : null}
                <span>{healthMeta}</span>
              </div>
            ) : null}
          </div>

          <div className="ms-auto flex shrink-0 items-center gap-0.5">
            {healthActionProps ? (
              <LinkHealthActions group="maintain" {...healthActionProps} />
            ) : null}
            {showReport && (
              <Tooltip content="报告失效">
                <Button
                  size="sm"
                  variant="light"
                  isIconOnly
                  aria-label="报告失效"
                  className="shrink-0"
                  onPress={report.onOpen}
                >
                  <Flag className="size-4" />
                </Button>
              </Tooltip>
            )}
          </div>
        </div>

        {credentials}

        {quota && quota.remaining.daily <= 2 && (
          <p className="text-sm text-default-500" role="status">
            您当前是游客，今日还可获取 {quota.remaining.daily} 个游戏资源条目
          </p>
        )}

        {healthActionProps ? (
          <LinkHealthActions group="decide" {...healthActionProps} />
        ) : null}

        <Modal
          isOpen={report.isOpen}
          onClose={report.onClose}
          scrollBehavior="inside"
        >
          <ModalContent>
            <ModalHeader className="flex flex-col gap-1">
              报告失效
              <span className="text-sm font-normal text-default-500">
                {SUPPORTED_RESOURCE_LINK_MAP[link.storage] ?? link.storage} ·{' '}
                {link.size}
              </span>
            </ModalHeader>
            <ModalBody className="pb-6">
              {health && (
                <LinkReportPanel
                  patchId={resource.patchId}
                  resourceId={resource.id}
                  link={health}
                  onCancel={report.onClose}
                  onLoginRequired={login.onOpen}
                  onReported={applyLocalHealthResult}
                />
              )}
            </ModalBody>
          </ModalContent>
        </Modal>

        <CaseLoginPrompt
          isOpen={login.isOpen}
          onOpenChange={login.onOpenChange}
          action="报告失效"
        />
      </CardBody>
    </Card>
  )
}
