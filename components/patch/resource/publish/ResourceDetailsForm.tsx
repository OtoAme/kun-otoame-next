'use client'

import { useState } from 'react'
import { Controller } from 'react-hook-form'
import { Input, Textarea } from '@heroui/input'
import { Button } from '@heroui/button'
import { Select, SelectItem } from '@heroui/select'
import {
  resourceTypes,
  SUPPORTED_LANGUAGE,
  SUPPORTED_LANGUAGE_MAP,
  SUPPORTED_PLATFORM,
  SUPPORTED_PLATFORM_MAP
} from '~/constants/resource'
import { ControlType, ErrorType } from '../share'
import { CLOUDREVE_PAN_DOMAIN, formatSize } from './fetchAlistSize'
import toast from 'react-hot-toast'

interface ResourceDetailsFormProps {
  control: ControlType
  errors: ErrorType
  content?: string
  storage?: string
}

export const ResourceDetailsForm = ({
  control,
  errors,
  content,
  storage
}: ResourceDetailsFormProps) => {
  const [fetchingSize, setFetchingSize] = useState(false)

  const handleFetchSize = async (onChange: (value: string) => void) => {
    if (!content) {
      toast.error('请先填写资源链接')
      return
    }

    const links = content.trim().split(',')
    const cloudreveLink = links.find((link) =>
      link.includes(`${CLOUDREVE_PAN_DOMAIN}/s/`)
    )

    if (!cloudreveLink) {
      toast.error('未找到 OtoAme 官方盘链接')
      return
    }

    const key = cloudreveLink.split('/').pop()
    if (!key) {
      toast.error('无法解析分享链接')
      return
    }

    setFetchingSize(true)
    try {
      const res = await fetch(`/api/cloudreve/share-size?key=${key}`)
      const data = await res.json()
      if (res.ok && data.size) {
        onChange(formatSize(data.size))
        toast.success('获取文件大小成功')
      } else {
        toast.error(data.error || '获取文件大小失败')
      }
    } catch {
      toast.error('获取文件大小失败')
    } finally {
      setFetchingSize(false)
    }
  }

  return (
    <div className="space-y-2">
      <h3 className="text-lg font-medium">资源详情</h3>
      <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
        <Controller
          name="type"
          control={control}
          render={({ field }) => (
            <Select
              isRequired
              label="类型"
              placeholder="请选择资源的类型"
              selectionMode="multiple"
              selectedKeys={field.value}
              onSelectionChange={(key) => {
                field.onChange([...key] as string[])
              }}
              isInvalid={!!errors.type}
              errorMessage={errors.type?.message}
            >
              {resourceTypes.map((type) => (
                <SelectItem key={type.value} textValue={type.label}>
                  <div className="flex flex-col">
                    <span className="text">{type.label}</span>
                    <span className="text-small text-default-500">
                      {type.description}
                    </span>
                  </div>
                </SelectItem>
              ))}
            </Select>
          )}
        />

        <Controller
          name="language"
          control={control}
          render={({ field }) => (
            <Select
              isRequired
              label="语言"
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
                <SelectItem key={lang}>{SUPPORTED_LANGUAGE_MAP[lang]}</SelectItem>
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
              placeholder="请选择资源的平台"
              selectionMode="multiple"
              selectedKeys={field.value}
              onSelectionChange={(key) => {
                field.onChange([...key] as string[])
              }}
              isInvalid={!!errors.platform}
              errorMessage={errors.platform?.message}
            >
              {SUPPORTED_PLATFORM.map((platform) => (
                <SelectItem key={platform}>
                  {SUPPORTED_PLATFORM_MAP[platform]}
                </SelectItem>
              ))}
            </Select>
          )}
        />

        <Controller
          name="size"
          control={control}
          render={({ field }) => (
            <Input
              {...field}
              isRequired
              label="大小 (MB 或 GB)"
              placeholder="请输入资源的大小, 例如 1.007MB"
              isInvalid={!!errors.size}
              errorMessage={errors.size?.message}
              endContent={
                storage === 'touchgal' && (
                  <Button
                    className="h-7 min-w-12 px-3 text-xs"
                    size="sm"
                    variant="flat"
                    isLoading={fetchingSize}
                    onPress={() => handleFetchSize(field.onChange)}
                  >
                    获取
                  </Button>
                )
              }
            />
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
            placeholder="请填写您的资源名称, 例如 DeepSeek V3 翻译补丁"
            isInvalid={!!errors.note}
            errorMessage={errors.note?.message}
          />
        )}
      />

      <Controller
        name="code"
        control={control}
        render={({ field }) => (
          <Input
            {...field}
            label="提取码"
            placeholder="如果资源的获取需要密码, 请填写密码"
            isInvalid={!!errors.password}
            errorMessage={errors.password?.message}
          />
        )}
      />

      <Controller
        name="password"
        control={control}
        render={({ field }) => (
          <Input
            {...field}
            label="解压码"
            placeholder="如果资源的解压需要解压码, 请填写解压码"
            isInvalid={!!errors.code}
            errorMessage={errors.code?.message}
            endContent={
              <Button
                className="h-7 min-w-12 px-3 text-xs"
                size="sm"
                variant="flat"
                onPress={() => field.onChange('otoame')}
              >
                otoame
              </Button>
            }
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
            placeholder="您可以在此处随意添加备注, 例如资源的注意事项等"
            isInvalid={!!errors.note}
            errorMessage={errors.note?.message}
          />
        )}
      />
    </div>
  )
}
