'use client'

import { useEffect } from 'react'
import { Controller, useWatch } from 'react-hook-form'
import { Input, Textarea } from '@heroui/input'
import { Select, SelectItem, SelectSection } from '@heroui/select'
import {
  CHINESE_SUPPORT_RESOURCE_TYPES,
  GAME_RESOURCE_TYPES,
  canSelectChineseSupportType,
  getResourceTypeOptionsBySection,
  getAllowedPlatformsBySectionAndTypes,
  hasChineseSupportType,
  requiresChineseSupportType,
  SUPPORTED_LANGUAGE,
  SUPPORTED_LANGUAGE_MAP,
  SUPPORTED_PLATFORM_MAP,
  type ResourceSection
} from '~/constants/resource'
import { resourceFieldClassNames } from './formClassNames'
import { ControlType, ErrorType } from '../share'

interface ResourceDetailsFormProps {
  control: ControlType
  setValue: (name: 'type' | 'platform', value: string[]) => void
  errors: ErrorType
  section: ResourceSection
}

const isChineseSupportType = (
  type: string
): type is (typeof CHINESE_SUPPORT_RESOURCE_TYPES)[number] =>
  CHINESE_SUPPORT_RESOURCE_TYPES.includes(
    type as (typeof CHINESE_SUPPORT_RESOURCE_TYPES)[number]
  )

const RESOURCE_TYPE_LISTBOX_MAX_HEIGHT = {
  galgame: 300,
  patch: 300,
  chineseSupport: 256
} as const

export const ResourceDetailsForm = ({
  control,
  setValue,
  errors,
  section
}: ResourceDetailsFormProps) => {
  const selectedTypes = useWatch({ control, name: 'type' }) || []
  const selectedPlatforms = useWatch({ control, name: 'platform' }) || []

  useEffect(() => {
    if (section !== 'galgame' || canSelectChineseSupportType(selectedTypes)) {
      return
    }

    const normalizedTypes = selectedTypes.filter(
      (type) => !isChineseSupportType(type)
    )
    if (normalizedTypes.length !== selectedTypes.length) {
      const nextAllowedPlatforms = getAllowedPlatformsBySectionAndTypes(
        section,
        normalizedTypes
      )
      const filteredPlatforms = selectedPlatforms.filter((platform) =>
        nextAllowedPlatforms.includes(platform)
      )
      setValue('type', normalizedTypes)
      if (filteredPlatforms.length !== selectedPlatforms.length) {
        setValue('platform', filteredPlatforms)
      }
    }
  }, [section, selectedPlatforms, selectedTypes, setValue])

  const resourceTypes = getResourceTypeOptionsBySection(section)
  const allowedPlatforms = getAllowedPlatformsBySectionAndTypes(
    section,
    selectedTypes
  )
  const getResourceTypeOptions = (typeValues: readonly string[]) =>
    typeValues.flatMap((typeValue) => {
      const option = resourceTypes.find((type) => type.value === typeValue)
      return option ? [option] : []
    })

  const resourceTypeGroups = [
    {
      key: 'game-types',
      title: '游戏类型',
      types: GAME_RESOURCE_TYPES
    },
    {
      key: 'other-types',
      title: '其他类型',
      types: resourceTypes
        .map((type) => type.value)
        .filter(
          (type) =>
            !GAME_RESOURCE_TYPES.includes(
              type as (typeof GAME_RESOURCE_TYPES)[number]
            ) && !isChineseSupportType(type)
        )
    }
  ]
  const resourceTypeGroupOptions = resourceTypeGroups
    .map((group) => ({
      ...group,
      options: getResourceTypeOptions(group.types)
    }))
    .filter((group) => group.options.length > 0)
  const chineseSupportOptions = getResourceTypeOptions(
    CHINESE_SUPPORT_RESOURCE_TYPES
  )

  const updateResourceTypes = (
    nextTypes: string[],
    onChange: (value: string[]) => void
  ) => {
    const normalizedTypes = Array.from(new Set(nextTypes))
    onChange(normalizedTypes)

    const nextAllowedPlatforms = getAllowedPlatformsBySectionAndTypes(
      section,
      normalizedTypes
    )
    const filteredPlatforms = selectedPlatforms.filter((platform) =>
      nextAllowedPlatforms.includes(platform)
    )
    setValue('platform', filteredPlatforms)
  }

  const renderResourceType = (type: (typeof resourceTypes)[number]) => (
    <SelectItem key={type.value} textValue={type.label}>
      <div className="flex flex-col">
        <span className="text">{type.label}</span>
        <span className="select-none text-small text-default-500">
          {type.description}
        </span>
      </div>
    </SelectItem>
  )

  return (
    <div className="space-y-2">
      <h3 className="text-lg font-medium">资源详情</h3>
      <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
        <Controller
          name="type"
          control={control}
          render={({ field }) => {
            const selectedTypes = field.value || []
            const selectedGameAndOtherTypes = selectedTypes.filter(
              (type) => !isChineseSupportType(type)
            )
            const selectedChineseSupportTypes =
              selectedTypes.filter(isChineseSupportType)
            const chineseSupportDisabled =
              section === 'galgame' &&
              !canSelectChineseSupportType(selectedTypes)
            const visibleChineseSupportTypes = chineseSupportDisabled
              ? []
              : selectedChineseSupportTypes
            const requiresChineseSupport =
              section === 'galgame' &&
              !chineseSupportDisabled &&
              requiresChineseSupportType(selectedTypes)
            const hasChineseSupportError =
              requiresChineseSupport &&
              !!errors.type &&
              !hasChineseSupportType(selectedTypes)

            return (
              <>
                <Select
                  isRequired
                  label="类型"
                  classNames={resourceFieldClassNames}
                  placeholder="请选择资源的类型"
                  selectionMode="multiple"
                  maxListboxHeight={
                    section === 'galgame'
                      ? RESOURCE_TYPE_LISTBOX_MAX_HEIGHT.galgame
                      : RESOURCE_TYPE_LISTBOX_MAX_HEIGHT.patch
                  }
                  popoverProps={{
                    placement: 'top',
                    shouldFlip: false
                  }}
                  showScrollIndicators
                  selectedKeys={selectedGameAndOtherTypes}
                  onSelectionChange={(key) => {
                    const nextGameAndOtherTypes = [...key] as string[]
                    updateResourceTypes(
                      [
                        ...nextGameAndOtherTypes,
                        ...(canSelectChineseSupportType(nextGameAndOtherTypes)
                          ? selectedChineseSupportTypes
                          : [])
                      ],
                      field.onChange
                    )
                  }}
                  isInvalid={!!errors.type && !hasChineseSupportError}
                  errorMessage={
                    !hasChineseSupportError ? errors.type?.message : undefined
                  }
                >
                  {section === 'galgame'
                    ? resourceTypeGroupOptions.map((group) => {
                      return (
                        <SelectSection key={group.key} title={group.title}>
                          {group.options.map(renderResourceType)}
                        </SelectSection>
                      )
                    })
                    : resourceTypes.map(renderResourceType)}
                </Select>

                {section === 'galgame' && (
                  <Select
                    isRequired={requiresChineseSupport}
                    label="中文支持"
                    isDisabled={chineseSupportDisabled}
                    classNames={resourceFieldClassNames}
                    placeholder="请选择游戏的中文支持类型"
                    selectionMode="multiple"
                    maxListboxHeight={
                      RESOURCE_TYPE_LISTBOX_MAX_HEIGHT.chineseSupport
                    }
                    popoverProps={{
                      placement: 'top',
                      shouldFlip: false
                    }}
                    showScrollIndicators
                    selectedKeys={visibleChineseSupportTypes}
                    onSelectionChange={(key) => {
                      updateResourceTypes(
                        [
                          ...selectedGameAndOtherTypes,
                          ...([...key] as string[])
                        ],
                        field.onChange
                      )
                    }}
                    isInvalid={hasChineseSupportError}
                    errorMessage={
                      hasChineseSupportError ? errors.type?.message : undefined
                    }
                  >
                    {chineseSupportOptions.map(renderResourceType)}
                  </Select>
                )}

                {section === 'patch' && (
                  <div
                    data-testid="resource-type-hint"
                    className="flex h-full items-center px-3 text-small text-foreground-500"
                  >
                    提示：翻译补丁包括
                    <br></br>
                    民汉补丁、AI 翻译补丁、机翻补丁
                  </div>
                )}
              </>
            )
          }}
        />

        <Controller
          name="language"
          control={control}
          render={({ field }) => (
            <Select
              isRequired
              label="语言"
              classNames={resourceFieldClassNames}
              placeholder="请选择语言"
              selectionMode="multiple"
              selectedKeys={field.value}
              onSelectionChange={(key) => {
                field.onChange([...key] as string[])
              }}
              isInvalid={!!errors.language}
              errorMessage={errors.language?.message}
            >
              {SUPPORTED_LANGUAGE.map((lang) => (
                <SelectItem key={lang}>
                  {SUPPORTED_LANGUAGE_MAP[lang]}
                </SelectItem>
              ))}
            </Select>
          )}
        />

        <Controller
          name="platform"
          control={control}
          render={({ field }) => (
            <Select
              isRequired
              label="平台"
              classNames={resourceFieldClassNames}
              placeholder="请选择资源的平台"
              selectionMode="multiple"
              selectedKeys={field.value}
              onSelectionChange={(key) => {
                field.onChange([...key] as string[])
              }}
              isInvalid={!!errors.platform}
              errorMessage={errors.platform?.message}
            >
              {allowedPlatforms.map((platform) => (
                <SelectItem key={platform}>
                  {SUPPORTED_PLATFORM_MAP[platform]}
                </SelectItem>
              ))}
            </Select>
          )}
        />
      </div>

      <Controller
        name="name"
        control={control}
        render={({ field }) => (
          <Input
            {...field}
            label="资源名称"
            classNames={resourceFieldClassNames}
            placeholder="请填写您的资源名称, 例如 [PC-CHS]魔法少女的魔女审判"
            isInvalid={!!errors.name}
            errorMessage={errors.name?.message}
          />
        )}
      />

      <Controller
        name="note"
        control={control}
        render={({ field }) => (
          <Textarea
            {...field}
            label="备注"
            classNames={resourceFieldClassNames}
            placeholder="您可以在此处随意添加备注, 例如资源的注意事项等"
            isInvalid={!!errors.note}
            errorMessage={errors.note?.message}
          />
        )}
      />
    </div>
  )
}
