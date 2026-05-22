import { Chip } from '@heroui/chip'
import {
  SUPPORTED_LANGUAGE_MAP,
  SUPPORTED_PLATFORM_MAP,
  SUPPORTED_TYPE_MAP,
  sortResourceTypes
} from '~/constants/resource'
import type { Patch } from '~/types/api/patch'
import { semanticChipProps } from '~/utils/semanticColor'

interface PatchHeaderProps {
  patch: Patch
}

export const Tags = ({ patch }: PatchHeaderProps) => {
  return (
    <>
      {patch.platform.length > 0 &&
        patch.platform.map((platform) => (
          <Chip key={platform} {...semanticChipProps('resource-platform')}>
            {SUPPORTED_PLATFORM_MAP[platform]}
          </Chip>
        ))}

      {patch.language.length > 0 &&
        patch.language.map((language) => (
          <Chip key={language} {...semanticChipProps('resource-language')}>
            {SUPPORTED_LANGUAGE_MAP[language]}
          </Chip>
        ))}

      {patch.type.length > 0 &&
        sortResourceTypes(patch.type).map((type) => (
          <Chip
            key={type}
            {...semanticChipProps('resource-type', { variant: 'solid' })}
          >
            {SUPPORTED_TYPE_MAP[type]}
          </Chip>
        ))}
    </>
  )
}
