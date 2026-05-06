'use client'

import { Snippet } from '@heroui/snippet'
import { Chip } from '@heroui/chip'
import { Cloud, Database, Link as LinkIcon } from 'lucide-react'
import { Microsoft } from '~/components/kun/icons/Microsoft'
import { SUPPORTED_RESOURCE_LINK_MAP } from '~/constants/resource'
import { kunFetchPut } from '~/utils/kunFetch'
import { KunExternalLink } from '~/components/kun/external-link/ExternalLink'
import { parseResourceLink, splitResourceCodes } from '~/utils/resourceLink'
import type { JSX } from 'react'
import type { PatchResource } from '~/types/api/patch'

const storageIcons: { [key: string]: JSX.Element } = {
  s3: <Cloud className="size-4" />,
  onedrive: <Microsoft className="size-4" />,
  user: <LinkIcon className="size-4" />
}

interface Props {
  resource: PatchResource
}

interface CodeSnippetProps {
  label: string
  value: string
}

const CodeSnippet = ({ label, value }: CodeSnippetProps) => (
  <Snippet
    tooltipProps={{
      content: `点击复制${label}`
    }}
    size="sm"
    symbol={label}
    color="primary"
    className="max-w-full py-0"
  >
    {value}
  </Snippet>
)

export const ResourceDownloadCard = ({ resource }: Props) => {
  const links = resource.content
    .split(/[,，\n]/)
    .map((link) => link.trim())
    .filter(Boolean)
  const codes = splitResourceCodes(resource.code)
  const canMatchCodesByIndex = codes.length === links.length

  const handleClickDownload = async () => {
    await kunFetchPut<KunResponse<{}>>(
      '/patch/resource/download',
      {
        patchId: resource.patchId,
        resourceId: resource.id
      },
      { keepalive: true }
    )
  }

  return (
    <div className="flex flex-col space-y-2">
      <div className="flex items-center gap-2">
        <Chip
          color="secondary"
          variant="flat"
          startContent={storageIcons[resource.storage]}
        >
          {
            SUPPORTED_RESOURCE_LINK_MAP[
              resource.storage as 's3' | 'onedrive' | 'user'
            ]
          }
        </Chip>
        <Chip variant="flat" startContent={<Database className="w-4 h-4" />}>
          {resource.size}
        </Chip>
      </div>

      <p className="text-sm text-default-500">点击下面的链接以下载</p>

      {links.map((link, index) => {
        const code =
          parseResourceLink(link).code ||
          (canMatchCodesByIndex || links.length === 1 ? codes[index] : '')

        return (
          <div key={`${link}-${index}`} className="space-y-2">
            <KunExternalLink
              onClick={handleClickDownload}
              underline="always"
              className="break-all"
              link={link}
            >
              {link}
            </KunExternalLink>

            {(code || resource.password) && (
              <div className="flex flex-wrap gap-2">
                {code && <CodeSnippet label="提取码" value={code} />}
                {resource.password && (
                  <CodeSnippet label="解压码" value={resource.password} />
                )}
              </div>
            )}
          </div>
        )
      })}

      {resource.storage === 's3' && (
        <div className="space-y-2">
          <p className="text-sm">
            BLACK3 校验码 (您可以根据此校验码校验下载文件完整性)
          </p>
          <Snippet symbol="" className="flex overflow-auto whitespace-normal">
            {resource.hash}
          </Snippet>
        </div>
      )}
    </div>
  )
}
