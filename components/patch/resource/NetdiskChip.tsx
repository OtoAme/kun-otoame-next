'use client'

import { Chip } from '@heroui/chip'
import { Database, Link2 } from 'lucide-react'
import {
  RESOURCE_DISK_KIND_LABELS,
  type ResourceDiskKind
} from '~/utils/resourceDiskKind'
import type { LinkCheckProvider } from '~/types/api/linkHealth'

const brandImgClass =
  'size-5 shrink-0 rounded-[5px] border border-black/[0.08] bg-white object-contain'

const BrandTile = ({ children }: { children: React.ReactNode }) => (
  <span className="flex size-5 shrink-0 items-center justify-center rounded-[5px] border border-black/[0.08] bg-white">
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
            width={16}
            height={12}
            className="w-4 shrink-0 object-contain"
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
        <Database className="size-3.5 text-default-700" aria-hidden />
      </BrandTile>
    )
  }
  if (kind === 'other') {
    return (
      <BrandTile>
        <Link2 className="size-3.5 text-default-700" aria-hidden />
      </BrandTile>
    )
  }
  return <NetdiskMark id={kind} />
}

interface Props {
  kind: ResourceDiskKind
}

export const NetdiskChip = ({ kind }: Props) => (
  <Chip
    size="sm"
    color="primary"
    variant="flat"
    startContent={<DiskMark kind={kind} />}
    className="h-7 pl-1.5"
    classNames={{ content: 'font-medium' }}
  >
    {RESOURCE_DISK_KIND_LABELS[kind]}
  </Chip>
)
