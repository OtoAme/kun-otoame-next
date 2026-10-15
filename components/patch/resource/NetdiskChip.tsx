'use client'

import { Chip } from '@heroui/chip'
import { LINK_CHECK_PROVIDER_LABELS } from '~/constants/linkHealth'
import type { LinkCheckProvider } from '~/types/api/linkHealth'

const brandImgClass =
  'size-5 shrink-0 rounded-[5px] border border-black/[0.08] bg-white object-contain'

const BrandTile = ({ children }: { children: React.ReactNode }) => (
  <span className="flex size-5 shrink-0 items-center justify-center rounded-[5px] border border-black/[0.08] bg-white">
    {children}
  </span>
)

const ProviderMark = ({ id }: { id: LinkCheckProvider }) => {
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

interface Props {
  provider: LinkCheckProvider | null | undefined
}

export const NetdiskChip = ({ provider }: Props) => {
  if (!provider) {
    return null
  }

  return (
    <Chip
      size="sm"
      color="primary"
      variant="flat"
      startContent={<ProviderMark id={provider} />}
      className="h-7 pl-1.5"
      classNames={{ content: 'font-medium' }}
    >
      {LINK_CHECK_PROVIDER_LABELS[provider]}
    </Chip>
  )
}
