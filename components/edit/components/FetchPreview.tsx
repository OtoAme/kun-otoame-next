'use client'

import { Chip } from '@heroui/react'

interface PreviewField {
  label: string
  value: string | string[]
}

interface Props {
  fields: PreviewField[]
}

export const FetchPreview = ({ fields }: Props) => {
  const visibleFields = fields.filter((field) =>
    Array.isArray(field.value) ? field.value.length > 0 : !!field.value
  )

  if (!visibleFields.length) return null

  return (
    <div className="rounded-lg border border-default-200 bg-default-50 dark:bg-default-100/50 p-3 space-y-2">
      {visibleFields.map((field) => (
        <div key={field.label} className="flex flex-wrap items-start gap-1.5">
          <span className="text-xs text-default-500 shrink-0 leading-6">
            {field.label}:
          </span>
          {Array.isArray(field.value) ? (
            <div className="flex flex-wrap gap-1">
              {field.value.map((value) => (
                <Chip key={value} size="sm" variant="flat">
                  {value}
                </Chip>
              ))}
            </div>
          ) : (
            <span className="text-sm text-default-700 dark:text-default-300 leading-6">
              {field.value}
            </span>
          )}
        </div>
      ))}
    </div>
  )
}
