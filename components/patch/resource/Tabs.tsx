'use client'

import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import {
  Button,
  Card,
  CardHeader,
  CardBody,
  Chip,
  Dropdown,
  DropdownItem,
  DropdownMenu,
  DropdownTrigger,
  User,
  Tab,
  Tabs
} from '@heroui/react'
import { Edit, MoreHorizontal, Trash2 } from 'lucide-react'
import { useUserStore } from '~/store/userStore'
import { ResourceInfo } from './ResourceInfo'
import { ResourceDownload } from './ResourceDownload'
import { ResourceCaseBadge } from '~/components/case/ResourceCaseBadge'
import { ReportResourceButton } from '~/components/case/ReportResourceButton'
import { ResourceShareButton } from './ResourceShareButton'
import { useResourceLinkHealthUpdates } from './useResourceLinkHealthUpdates'
import {
  RESOURCE_SECTION_MAP,
  SUPPORTED_RESOURCE_SECTION
} from '~/constants/resource'
import { accessResourceLinksForEdit } from './accessResourceLinksForEdit'
import { kunFetchPost } from '~/utils/kunFetch'
import { KunLoading } from '~/components/kun/Loading'
import { KunNull } from '~/components/kun/Null'
import type { PatchResource } from '~/types/api/patch'
import Link from 'next/link'
import { kunMoyuMoe } from '~/config/moyu-moe'
import toast from 'react-hot-toast'
import { canManageResource } from './resourcePermissions'

type ResourceSection = (typeof SUPPORTED_RESOURCE_SECTION)[number]

interface Props {
  vndbId: string
  /** 当前条目 ID，用于报告问题时携带 expectedPatchId 校验。 */
  patchId: number
  resources: PatchResource[]
  setEditResource: (resources: PatchResource) => void
  onOpenEdit: () => void
  onOpenDelete: () => void
  setDeleteResourceId: (resourceId: number) => void
  selectedSection: ResourceSection
  setSelectedSection: (section: ResourceSection) => void
}

const ResourceCard = ({
  resource,
  patchId,
  highlighted,
  canManage,
  editLoading,
  onEdit,
  onDelete
}: {
  resource: PatchResource
  patchId: number
  highlighted: boolean
  canManage: boolean
  editLoading: boolean
  onEdit: (resource: PatchResource, focusLinkId?: number) => void
  onDelete: () => void
}) => {
  const { healthUpdateFor, onReported } = useResourceLinkHealthUpdates(resource)

  return (
    <Card
      id={`resource-${resource.id}`}
      shadow="none"
      radius="lg"
      className={
        highlighted
          ? 'min-w-0 max-w-full overflow-visible border border-default-200 ring-2 ring-primary ring-offset-2 ring-offset-background'
          : 'min-w-0 max-w-full overflow-visible border border-default-200'
      }
    >
      <CardBody className="min-w-0 max-w-full space-y-2 overflow-visible p-3">
        <div className="flex items-start justify-between gap-x-3 gap-y-1">
          <ResourceInfo resource={resource} />
          <div className="ms-auto flex shrink-0 items-center gap-1">
            <ResourceShareButton resource={resource} />
            <ReportResourceButton
              resource={resource}
              patchId={patchId}
              healthUpdateFor={healthUpdateFor}
              onReported={onReported}
              compact
            />
            {canManage && (
              <Dropdown>
                <DropdownTrigger>
                  <Button
                    size="sm"
                    variant="light"
                    isIconOnly
                    isDisabled={editLoading}
                    isLoading={editLoading}
                    aria-label="资源操作"
                  >
                    <MoreHorizontal className="size-4" />
                  </Button>
                </DropdownTrigger>
                <DropdownMenu aria-label="资源操作">
                  <DropdownItem
                    key="edit"
                    startContent={<Edit className="size-4" />}
                    onPress={() => onEdit(resource)}
                  >
                    编辑
                  </DropdownItem>
                  <DropdownItem
                    key="delete"
                    className="text-danger"
                    color="danger"
                    startContent={<Trash2 className="size-4" />}
                    onPress={onDelete}
                  >
                    删除
                  </DropdownItem>
                </DropdownMenu>
              </Dropdown>
            )}
          </div>
        </div>
        {resource.caseSummaries?.length ? (
          <div className="flex flex-wrap gap-2">
            {resource.caseSummaries.map((summary) => (
              <ResourceCaseBadge key={summary.kind} summary={summary} />
            ))}
          </div>
        ) : null}
        <ResourceDownload
          resource={resource}
          hideReportButton
          healthUpdateFor={healthUpdateFor}
          onHealthResult={onReported}
          onEdit={(target, focusLinkId) => onEdit(target, focusLinkId)}
        />
      </CardBody>
    </Card>
  )
}

export const ResourceTabs = ({
  vndbId,
  patchId,
  resources,
  setEditResource,
  onOpenEdit,
  onOpenDelete,
  setDeleteResourceId,
  selectedSection,
  setSelectedSection
}: Props) => {
  const searchParams = useSearchParams()
  const { user } = useUserStore((state) => state)
  const [highlightedResourceId, setHighlightedResourceId] = useState<
    number | null
  >(null)
  const [editLoadingResourceId, setEditLoadingResourceId] = useState<
    number | null
  >(null)
  const RESOURCE_SECTION_TABS_ID = 'patch-resource-section-tabs'

  const targetResourceId = useMemo(() => {
    const rawResourceId = searchParams.get('resourceId')
    if (!rawResourceId) {
      return null
    }

    const parsedResourceId = Number(rawResourceId)
    return Number.isSafeInteger(parsedResourceId) && parsedResourceId > 0
      ? parsedResourceId
      : null
  }, [searchParams])

  const targetResourceSection = useMemo(() => {
    const section = searchParams.get('resourceSection')
    return SUPPORTED_RESOURCE_SECTION.includes(section as ResourceSection)
      ? (section as ResourceSection)
      : null
  }, [searchParams])

  useEffect(() => {
    if (targetResourceSection) {
      setSelectedSection(targetResourceSection)
      return
    }

    if (!targetResourceId) {
      return
    }

    const targetResource = resources.find(
      (resource) => resource.id === targetResourceId
    )
    if (targetResource) {
      setSelectedSection(targetResource.section as ResourceSection)
    }
  }, [resources, setSelectedSection, targetResourceId, targetResourceSection])

  useEffect(() => {
    if (!targetResourceId) {
      return
    }

    const targetElement = document.getElementById(
      `resource-${targetResourceId}`
    )
    if (!targetElement) {
      setHighlightedResourceId(null)
      return
    }

    targetElement.scrollIntoView({ behavior: 'smooth', block: 'center' })
    setHighlightedResourceId(targetResourceId)

    const timer = window.setTimeout(() => {
      setHighlightedResourceId((current) =>
        current === targetResourceId ? null : current
      )
    }, 3000)

    return () => window.clearTimeout(timer)
  }, [resources, selectedSection, targetResourceId])

  const categorizedResources = SUPPORTED_RESOURCE_SECTION.reduce(
    (acc, section) => {
      acc[section] = resources.filter((r) => r.section === section)
      return acc
    },
    {} as Record<ResourceSection, PatchResource[]>
  )

  const handleOpenEditResource = async (
    resource: PatchResource,
    focusLinkId?: number
  ) => {
    setEditLoadingResourceId(resource.id)

    try {
      const hydratedResource = await accessResourceLinksForEdit(
        resource,
        kunFetchPost,
        focusLinkId
      )
      if (typeof hydratedResource === 'string') {
        toast.error(hydratedResource)
        return
      }

      setEditResource(hydratedResource)
      onOpenEdit()
    } catch {
      toast.error('获取资源链接失败，请稍后重试')
    } finally {
      setEditLoadingResourceId(null)
    }
  }

  const renderResourceCard = (resource: PatchResource) => (
    <ResourceCard
      key={resource.id}
      resource={resource}
      patchId={patchId}
      highlighted={highlightedResourceId === resource.id}
      canManage={canManageResource({
        resourceUserId: resource.userId,
        userId: user.uid,
        userRole: user.role
      })}
      editLoading={editLoadingResourceId === resource.id}
      onEdit={(target, focusLinkId) =>
        void handleOpenEditResource(target, focusLinkId)
      }
      onDelete={() => {
        setDeleteResourceId(resource.id)
        onOpenDelete()
      }}
    />
  )

  return (
    <Tabs
      id={RESOURCE_SECTION_TABS_ID}
      selectedKey={selectedSection}
      onSelectionChange={(key) => setSelectedSection(key as ResourceSection)}
      className="mb-4 scroll-mt-24"
    >
      {SUPPORTED_RESOURCE_SECTION.map((section) => {
        const sectionResources = categorizedResources[section]
        const sectionCount = sectionResources.length
        const official = sectionResources.filter((r) => r.user?.role > 2)
        const community = sectionResources.filter((r) => !(r.user?.role > 2))

        return (
          <Tab
            key={section}
            title={
              <div className="flex items-center gap-2">
                <span>{RESOURCE_SECTION_MAP[section]}</span>
                <Chip
                  size="sm"
                  variant="bordered"
                  className="border-default-300 bg-transparent text-inherit"
                >
                  {sectionCount}
                </Chip>
              </div>
            }
            className="w-full"
          >
            <div className="space-y-6">
              {official.length > 0 && (
                <Card className="min-w-0 max-w-full overflow-visible">
                  <CardHeader>
                    <Link href="/">
                      <User
                        avatarProps={{
                          src: '/favicon.webp',
                          classNames: {
                            base: 'bg-transparent'
                          }
                        }}
                        description={`${kunMoyuMoe.titleShort} 官方提供的 OtomeGame 下载资源`}
                        name={`${kunMoyuMoe.titleShort} 官方 (推荐下载)`}
                      />
                    </Link>
                  </CardHeader>
                  <CardBody className="min-w-0 max-w-full gap-3 overflow-visible">
                    {official.map((res) => renderResourceCard(res))}
                  </CardBody>
                </Card>
              )}

              {community.length > 0 && (
                <Card className="min-w-0 max-w-full overflow-visible">
                  <CardHeader>
                    <Link target="_blank" href={kunMoyuMoe.domain.forum}>
                      <User
                        avatarProps={{
                          src: '/sooner/琥珀.webp',
                          classNames: {
                            base: 'bg-transparent'
                          }
                        }}
                        description={`来自 ${kunMoyuMoe.titleShort} 用户自行发布的下载资源`}
                        name={`${kunMoyuMoe.titleShort} 社区下载资源`}
                      />
                    </Link>
                  </CardHeader>
                  <CardBody className="min-w-0 max-w-full gap-3 overflow-visible">
                    {community.map((res) => renderResourceCard(res))}
                  </CardBody>
                </Card>
              )}

              {section !== 'patch' &&
                official.length === 0 &&
                community.length === 0 && (
                  <KunNull
                    message={`本游戏暂无 ${RESOURCE_SECTION_MAP[section]}`}
                  />
                )}
            </div>
          </Tab>
        )
      })}
    </Tabs>
  )
}
