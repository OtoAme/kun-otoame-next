'use client'

import { Database, Link2 } from 'lucide-react'
import { Badge } from '~/components/dashboard/ui/badge'
import {
  RESOURCE_DISK_KIND_LABELS,
  type ResourceDiskKind
} from '~/utils/resourceDiskKind'
import type { LinkCheckProvider } from '~/types/api/linkHealth'

const brandImgClass =
  'size-4 shrink-0 rounded-[4px] border border-black/[0.08] bg-white object-contain'

const BrandTile = ({ children }: { children: React.ReactNode }) => (
  <span className="flex size-4 shrink-0 items-center justify-center rounded-[4px] border border-black/[0.08] bg-white">
    {children}
  </span>
)

const NetdiskMark = ({ id }: { id: LinkCheckProvider }) => {
  switch (id) {
    case 'baidu':
      return <img src="/brand/baidu.svg" alt="" className={brandImgClass} />
    case 'quark':
      return (
        <BrandTile>
          <img
            src="/brand/quark.svg"
            alt=""
            width={14}
            height={10}
            className="w-3.5 shrink-0 object-contain"
          />
        </BrandTile>
      )
    case 'uc':
      return <img src="/brand/uc.svg" alt="" className={brandImgClass} />
    case 'caiyun':
      return <img src="/brand/caiyun.svg" alt="" className={brandImgClass} />
    case 'pan123':
      return <img src="/brand/pan123.svg" alt="" className={brandImgClass} />
  }
}

const DiskMark = ({ kind }: { kind: ResourceDiskKind }) => {
  if (kind === 'otoame') {
    return <img src="/brand/cloudreve.svg" alt="" className={brandImgClass} />
  }
  if (kind === 'object') {
    return (
      <BrandTile>
        <Database className="size-3 text-foreground" aria-hidden />
      </BrandTile>
    )
  }
  if (kind === 'other') {
    return (
      <BrandTile>
        <Link2 className="size-3 text-foreground" aria-hidden />
      </BrandTile>
    )
  }
  return <NetdiskMark id={kind} />
}

export function WorkspaceDiskKindBadge({ kind }: { kind: ResourceDiskKind }) {
  return (
    <Badge variant="outline" className="h-6 gap-1 pl-1 font-medium">
      <DiskMark kind={kind} />
      {RESOURCE_DISK_KIND_LABELS[kind]}
    </Badge>
  )
}
