'use client'

import { useState } from 'react'
import { Snippet } from '@heroui/snippet'
import { Chip } from '@heroui/chip'
import { Button } from '@heroui/button'
import { Cloud, Database, Link as LinkIcon } from 'lucide-react'
import toast from 'react-hot-toast'
import { SUPPORTED_RESOURCE_LINK_MAP } from '~/constants/resource'
import { kunFetchPost, kunFetchPut } from '~/utils/kunFetch'
import { KunExternalLink } from '~/components/kun/external-link/ExternalLink'
import type { JSX } from 'react'
import type {
  PatchResource,
  PatchResourceAccessLink,
  PatchResourceAccessResponse,
  PatchResourceLink
} from '~/types/api/patch'

const storageIcons: { [key: string]: JSX.Element } = {
  touchgal: <Database className="size-4" />,
  s3: <Cloud className="size-4" />,
  user: <LinkIcon className="size-4" />
}

interface Props {
  resource: PatchResource
  link: PatchResourceLink
  restoredLink?: PatchResourceAccessLink
  restoredObtainedExpiresAt?: string
}

export const ResourceDownloadCard = ({
  resource,
  link,
  restoredLink,
  restoredObtainedExpiresAt
}: Props) => {
  const [manuallyAccessedLink, setManuallyAccessedLink] =
    useState<PatchResourceAccessLink | null>(null)
  const [manualObtainedExpiresAt, setManualObtainedExpiresAt] = useState('')
  const [accessing, setAccessing] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')
  const restoredAccessedLink =
    restoredLink?.id === link.id ? restoredLink : null
  const accessedLink = manuallyAccessedLink ?? restoredAccessedLink
  const obtainedExpiresAt =
    manualObtainedExpiresAt ||
    (restoredAccessedLink ? (restoredObtainedExpiresAt ?? '') : '') ||
    link.obtainedExpiresAt ||
    ''
  const hasActiveGrant = Boolean(link.obtained || obtainedExpiresAt)

  const handleClickDownload = async () => {
    await kunFetchPut<KunResponse<{}>>('/patch/resource/download', {
      patchId: resource.patchId,
      resourceId: resource.id,
      linkId: link.id
    })
  }

  const handleAccessLink = async () => {
    setAccessing(true)
    setErrorMessage('')

    try {
      const response = await kunFetchPost<PatchResourceAccessResponse | string>(
        '/patch/resource/download/access',
        {
          patchId: resource.patchId,
          resourceId: resource.id,
          linkId: link.id
        }
      )

      if (typeof response === 'string') {
        setErrorMessage(response)
        toast.error(response)
        return
      }

      setManuallyAccessedLink(response.link)
      setManualObtainedExpiresAt(response.access.obtainedExpiresAt)
    } catch {
      const message = '获取下载链接失败，请稍后重试'
      setErrorMessage(message)
      toast.error(message)
    } finally {
      setAccessing(false)
    }
  }

  const renderHash = (hash: string) =>
    link.storage === 's3' && hash ? (
      <div className="space-y-1">
        <p className="text-sm">
          BLACK3 校验码 (您可以根据此校验码校验下载文件完整性)
        </p>
        <Snippet symbol="" className="flex overflow-auto whitespace-normal">
          {hash}
        </Snippet>
      </div>
    ) : null

  const accessButtonText =
    link.revealed === true ? '查看已获取链接' : '获取下载链接'

  return (
    <div className="flex flex-col space-y-2">
      <div className="flex items-center gap-2">
        <Chip
          color="secondary"
          variant="flat"
          startContent={storageIcons[link.storage]}
        >
          {SUPPORTED_RESOURCE_LINK_MAP[link.storage] ?? link.storage}
        </Chip>
        <Chip variant="flat" startContent={<Database className="w-4 h-4" />}>
          {link.size}
        </Chip>
      </div>

      {accessedLink ? (
        <>
          <p className="text-sm text-default-500">点击下面的链接以下载</p>

          <div className="space-y-2">
            <KunExternalLink
              className="break-all"
              onPress={handleClickDownload}
              underline="always"
              link={accessedLink.content}
            >
              {accessedLink.content}
            </KunExternalLink>

            <div className="flex flex-wrap gap-2">
              {accessedLink.code && (
                <Snippet
                  tooltipProps={{
                    content: '点击复制提取码'
                  }}
                  size="sm"
                  symbol="提取码"
                  color="primary"
                  className="max-w-full py-0"
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
                  className="max-w-full py-0"
                >
                  {accessedLink.password}
                </Snippet>
              )}
            </div>

            {renderHash(accessedLink.hash)}
          </div>
        </>
      ) : (
        <div className="space-y-2">
          <Button
            color="primary"
            variant="flat"
            isLoading={accessing}
            isDisabled={accessing}
            startContent={!accessing ? <LinkIcon className="size-4" /> : null}
            onPress={handleAccessLink}
          >
            {accessButtonText}
          </Button>

          {hasActiveGrant && (
            <p className="text-sm text-default-500">
              授权有效期内可继续获取资源镜像。
            </p>
          )}

          {errorMessage && (
            <p role="alert" className="text-sm text-danger">
              {errorMessage}
            </p>
          )}

          {renderHash(link.hash)}
        </div>
      )}
    </div>
  )
}
