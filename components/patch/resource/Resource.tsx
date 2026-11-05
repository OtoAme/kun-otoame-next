'use client'

import { useEffect, useState } from 'react'
import {
  Button,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  useDisclosure
} from '@heroui/react'
import { kunFetchDelete, kunFetchGet } from '~/utils/kunFetch'
import { PublishResource } from './publish/PublishResource'
import { EditResourceDialog } from './edit/EditResourceDialog'
import { ResourceTabs } from './Tabs'
import { ResourceCreateAction } from './ResourceCreateAction'
import { KunLoading } from '~/components/kun/Loading'
import toast from 'react-hot-toast'
import { SUPPORTED_RESOURCE_SECTION } from '~/constants/resource'
import type { PatchResource } from '~/types/api/patch'
import { useUserStore } from '~/store/userStore'
import {
  ACTION_STALE_NOTICE,
  authorActionConfirmation,
  authorActionLabel,
  BACKUP_CHANGED_NOTICE,
  BACKUP_MISSING_NOTICE,
  confirmedExitAction,
  HANDOVER_SUCCESS,
  interpretPatchAuthorResponse,
  patchAuthorRequest,
  type AuthorResourceAction
} from './authorResourceAction'
import { isResourceGoneMessage } from './mergedResourceLocation'
import { readPublicMirrorFacts } from './publicMirrorFacts'
import { useMergedResourceNavigation } from './useMergedResourceNavigation'

interface Props {
  id: number
  vndbId: string
}

type ResourceSection = (typeof SUPPORTED_RESOURCE_SECTION)[number]

export const Resources = ({ id, vndbId }: Props) => {
  const { user, setMoemoepointBalance } = useUserStore((state) => state)
  const [loading, setLoading] = useState(true)
  const [listReady, setListReady] = useState(false)
  const [resources, setResources] = useState<PatchResource[]>([])
  const [selectedSection, setSelectedSection] =
    useState<ResourceSection>('galgame')

  useEffect(() => {
    let active = true
    const fetchData = async () => {
      setLoading(true)
      setListReady(false)
      try {
        const res = await kunFetchGet<PatchResource[] | string>(
          '/patch/resource',
          { patchId: Number(id) }
        )
        if (!active) return
        if (Array.isArray(res)) {
          setResources(res)
          setListReady(true)
        }
      } catch {
        if (!active) return
      } finally {
        if (active) setLoading(false)
      }
    }
    void fetchData()
    return () => {
      active = false
    }
  }, [id])

  const { relocateCachedMiss } = useMergedResourceNavigation({
    resources,
    listReady
  })

  const {
    isOpen: isOpenCreate,
    onOpen: onOpenCreate,
    onClose: onCloseCreate
  } = useDisclosure()

  const {
    isOpen: isOpenEdit,
    onOpen: onOpenEdit,
    onClose: onCloseEdit
  } = useDisclosure()
  const [editResource, setEditResource] = useState<PatchResource | null>(null)

  const {
    isOpen: isOpenDelete,
    onOpen: onOpenDelete,
    onClose: onCloseDelete
  } = useDisclosure()
  const [deleteResourceId, setDeleteResourceId] = useState(0)
  const [exitAction, setExitAction] = useState<AuthorResourceAction | null>(
    null
  )
  const [exitNotice, setExitNotice] = useState('')
  const [deleting, setDeleting] = useState(false)

  const liveExitAction = (resourceId: number): AuthorResourceAction | null => {
    const resource = resources.find((item) => item.id === resourceId)
    if (!resource) return null
    const facts = readPublicMirrorFacts(resource)
    return confirmedExitAction({
      userId: user.uid,
      userRole: user.role,
      resourceUserId: resource.userId,
      hasStaffBackup: facts.hasStaffBackup,
      staffMaintained: facts.staffMaintained
    })
  }

  const closeExit = () => {
    if (deleting) return
    setDeleteResourceId(0)
    setExitAction(null)
    setExitNotice('')
    onCloseDelete()
  }

  const openExit = (resourceId: number, action: AuthorResourceAction) => {
    setDeleteResourceId(resourceId)
    setExitAction(action)
    setExitNotice('')
    onOpenDelete()
  }

  const reloadResources = async () => {
    const res = await kunFetchGet<PatchResource[] | string>('/patch/resource', {
      patchId: Number(id)
    })
    if (Array.isArray(res)) setResources(res)
  }

  const handleExitResource = async () => {
    if (deleting || exitAction === null || deleteResourceId <= 0) return
    const live = liveExitAction(deleteResourceId)
    if (live !== exitAction) {
      setExitAction(live)
      setExitNotice(ACTION_STALE_NOTICE)
      return
    }
    const request = patchAuthorRequest(deleteResourceId, live)
    setDeleting(true)
    try {
      const response = await kunFetchDelete<unknown>(request.url, request.query)
      const result = interpretPatchAuthorResponse(live, response)
      if (!result.ok) {
        if (isResourceGoneMessage(result.message)) {
          const moved = await relocateCachedMiss(deleteResourceId)
          setDeleting(false)
          if (!moved) toast.error(result.message)
          return
        }
        if (
          result.message === BACKUP_CHANGED_NOTICE ||
          result.message === BACKUP_MISSING_NOTICE
        ) {
          setDeleting(false)
          setExitNotice(result.message)
          await reloadResources()
          return
        }
        toast.error(result.message)
        setDeleting(false)
        return
      }
      if (result.balanceUserId === user.uid) {
        setMoemoepointBalance(result.moemoepointBalance)
      }
      if (result.action === 'handed_over') {
        await reloadResources()
        toast.success(
          <span>
            {HANDOVER_SUCCESS}{' '}
            <a href={`/user/${user.uid}/resource`}>查看发布记录</a>
          </span>
        )
      } else {
        setResources((prev) =>
          prev.filter((resource) => resource.id !== deleteResourceId)
        )
        toast.success('删除资源链接成功')
      }
      setDeleting(false)
      setDeleteResourceId(0)
      setExitAction(null)
      setExitNotice('')
      onCloseDelete()
    } catch {
      toast.error('网络错误，请稍后重试')
      setDeleting(false)
    }
  }

  return (
    <div className="mt-4 space-y-4">
      <ResourceCreateAction onOpenCreate={onOpenCreate} />

      {loading ? (
        <KunLoading hint="正在获取 OtomeGame 资源数据..." />
      ) : (
        <ResourceTabs
          vndbId={vndbId}
          patchId={Number(id)}
          resources={resources}
          setEditResource={setEditResource}
          onOpenEdit={onOpenEdit}
          onOpenDelete={openExit}
          selectedSection={selectedSection}
          setSelectedSection={setSelectedSection}
        />
      )}

      <Modal
        size="3xl"
        isOpen={isOpenCreate}
        onClose={onCloseCreate}
        scrollBehavior="outside"
        isDismissable={false}
        isKeyboardDismissDisabled={true}
      >
        {isOpenCreate && (
          <PublishResource
            patchId={id}
            defaultSection={selectedSection}
            onClose={onCloseCreate}
            onSuccess={(res) => {
              setResources([...resources, res])
              onCloseCreate()
            }}
          />
        )}
      </Modal>

      <Modal
        size="3xl"
        isOpen={isOpenEdit}
        onClose={onCloseEdit}
        scrollBehavior="outside"
        isDismissable={false}
        isKeyboardDismissDisabled={true}
      >
        {/* 每次打开都重新挂载：基点随打开一次性捕获，关闭即销毁草稿生命周期 */}
        {isOpenEdit && editResource && (
          <EditResourceDialog
            onClose={onCloseEdit}
            resource={editResource}
            onSuccess={(res) => {
              setResources((prevResources) =>
                prevResources.map((resource) =>
                  resource.id === res.id ? res : resource
                )
              )
              onCloseEdit()
            }}
          />
        )}
      </Modal>

      <Modal
        isOpen={isOpenDelete}
        onClose={closeExit}
        placement="center"
        isDismissable={!deleting}
        isKeyboardDismissDisabled={deleting}
      >
        <ModalContent>
          <ModalHeader className="flex flex-col gap-1">
            {exitAction ? authorActionLabel(exitAction) : '删除资源链接'}
          </ModalHeader>
          <ModalBody>
            <p>
              {exitAction
                ? authorActionConfirmation(exitAction)
                : '备份状态已变化，请重新确认'}
            </p>
            {exitNotice ? <p>{exitNotice}</p> : null}
          </ModalBody>
          <ModalFooter>
            <Button variant="light" onPress={closeExit} isDisabled={deleting}>
              取消
            </Button>
            <Button
              color={exitAction === 'handover' ? 'primary' : 'danger'}
              onPress={() => void handleExitResource()}
              isDisabled={deleting || exitAction === null}
              isLoading={deleting}
            >
              {exitAction ? authorActionLabel(exitAction) : '确认'}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </div>
  )
}
