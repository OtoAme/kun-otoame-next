'use client'

import { Radio, RadioGroup } from '@heroui/react'
import { ErrorType } from '../share'
import {
  RESOURCE_SECTION_MAP,
  SUPPORTED_RESOURCE_SECTION,
  type ResourceSection
} from '~/constants/resource'

interface Props {
  errors: ErrorType
  section: ResourceSection
  setSection: (value: ResourceSection) => void
}

export const ResourceSectionSelect = ({
  errors,
  section,
  setSection
}: Props) => {
  return (
    <div className="space-y-2">
      <h3 className="text-lg font-medium">请选择资源的类别</h3>
      <RadioGroup
        value={section}
        onValueChange={(value) => setSection(value as ResourceSection)}
        isInvalid={!!errors.section}
        errorMessage={errors.section?.message}
      >
        {SUPPORTED_RESOURCE_SECTION.map((section) => (
          <Radio key={section} value={section}>
            {RESOURCE_SECTION_MAP[section]}
          </Radio>
        ))}
      </RadioGroup>
    </div>
  )
}
