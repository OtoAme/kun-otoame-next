'use client'

import { Chip } from '@heroui/chip'
import {
  SUPPORTED_LANGUAGE_MAP,
  SUPPORTED_PLATFORM_MAP,
  SUPPORTED_TYPE_MAP,
  sortResourceTypes
} from '~/constants/resource'
import { semanticChipProps } from '~/utils/semanticColor'

interface Props {
  types: string[]
  languages?: string[]
  platforms?: string[]
  size?: 'lg' | 'md' | 'sm'
  chipContentClassName?: string
}

const withContentClass = (
  props: ReturnType<typeof semanticChipProps>,
  chipContentClassName?: string
) =>
  chipContentClassName
    ? {
        ...props,
        classNames: {
          ...props.classNames,
          content: [props.classNames.content, chipContentClassName]
            .filter(Boolean)
            .join(' ')
        }
      }
    : props

export const KunPatchAttribute = ({
  types,
  languages = [],
  platforms = [],
  size = 'md',
  chipContentClassName
}: Props) => {
  return (
    <div className="flex flex-wrap gap-2">
      {sortResourceTypes(types).map((type) => (
        <Chip
          key={type}
          {...withContentClass(
            semanticChipProps('resource-type'),
            chipContentClassName
          )}
          size={size}
        >
          {SUPPORTED_TYPE_MAP[type]}
        </Chip>
      ))}
      {languages?.map((lang) => (
        <Chip
          key={lang}
          {...withContentClass(
            semanticChipProps('resource-language'),
            chipContentClassName
          )}
          size={size}
        >
          {SUPPORTED_LANGUAGE_MAP[lang]}
        </Chip>
      ))}
      {platforms?.map((platform) => (
        <Chip
          key={platform}
          {...withContentClass(
            semanticChipProps('resource-platform'),
            chipContentClassName
          )}
          size={size}
        >
          {SUPPORTED_PLATFORM_MAP[platform]}
        </Chip>
      ))}
    </div>
  )
}
