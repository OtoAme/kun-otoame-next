'use client'

import { useEffect, useRef } from 'react'
import { Input } from '@heroui/input'
import { Button } from '@heroui/button'
import { Chip } from '@heroui/chip'
import { Plus, X } from 'lucide-react'
import { ErrorType } from '../share'
import { SUPPORTED_RESOURCE_LINK_MAP } from '~/constants/resource'
import { CLOUDREVE_PAN_DOMAIN, formatSize } from './fetchAlistSize'
import toast from 'react-hot-toast'

interface ResourceLinksInputProps {
  errors: ErrorType
  storage: string
  content: string
  size: string
  setContent: (value: string) => void
  setSize: (value: string) => void
  setCode: (value: string) => void
}

const extractResourceLinkInfo = (text: string) => {
  const pastedText = text.trim()
  const codeMatch = pastedText.match(/(?:提取码|取码|密码)[:：\s]+([^\s,，]+)/)
  const urlMatch = pastedText.match(/https?:\/\/[^\s,，]+/)
  const link = urlMatch?.[0] ?? pastedText
  let code = codeMatch?.[1]

  try {
    const url = new URL(link)
    code ??=
      url.searchParams.get('pwd') ??
      url.searchParams.get('password') ??
      url.searchParams.get('code') ??
      undefined
  } catch {}

  return { link, code }
}

export const ResourceLinksInput = ({
  errors,
  storage,
  content,
  size,
  setContent,
  setSize,
  setCode
}: ResourceLinksInputProps) => {
  const links = content.trim() ? content.trim().split(',') : ['']
  const fetchedRef = useRef(false)

  const checkLinkSize = async (link: string) => {
    const key = link.split('/').pop()
    if (!key) return

    toast('正在尝试从 OtoAme 官方盘获取文件大小')
    try {
      const res = await fetch(`/api/cloudreve/share-size?key=${key}`)
      const data = await res.json()
      if (res.ok && data.size) {
        toast.success('获取文件大小成功')
        setSize(formatSize(data.size))
      }
    } catch {
      // silently fail for auto-fetch
    }
  }

  useEffect(() => {
    if (fetchedRef.current || !links.length || size) {
      return
    }
    if (links.some((link) => link.includes(`${CLOUDREVE_PAN_DOMAIN}/s/`))) {
      fetchedRef.current = true
      checkLinkSize(links[0])
    }
  }, [content])

  return (
    <div className="space-y-2">
      <h3 className="text-lg font-medium">资源链接</h3>
      <p className="text-sm text-default-500">
        {storage === 's3'
          ? '已为您自动创建资源链接 √'
          : '上传资源会自动添加资源链接, 您也可以自行添加资源链接。为保证单一性, 建议您一次添加一条资源链接'}
      </p>

      {links.map((link, index) => (
        <div key={index} className="flex items-center gap-2">
          <Chip color="primary" variant="flat">
            {
              SUPPORTED_RESOURCE_LINK_MAP[
              storage as keyof typeof SUPPORTED_RESOURCE_LINK_MAP
              ]
            }
          </Chip>

          <div className="flex-col w-full">
            <Input
              isRequired
              placeholder={
                storage === 's3' ? '资源链接不可编辑' : '请输入资源链接'
              }
              value={link}
              isReadOnly={storage === 's3'}
              isDisabled={storage === 's3'}
              isInvalid={!!errors.content}
              errorMessage={errors.content?.message}
              onChange={(e) => {
                e.preventDefault()
                const newLinks = [...links]
                newLinks[index] = e.target.value
                setContent(newLinks.filter(Boolean).toString())
              }}
              onPaste={(e) => {
                const pastedText = e.clipboardData.getData('text')
                const { link, code } = extractResourceLinkInfo(pastedText)

                if (!pastedText || (link === pastedText.trim() && !code)) {
                  return
                }

                e.preventDefault()
                const newLinks = [...links]
                newLinks[index] = link
                setContent(newLinks.filter(Boolean).toString())
                if (code) {
                  setCode(code)
                }
              }}
            />
          </div>

          {storage !== 's3' && (
            <div className="flex justify-end">
              {index === links.length - 1 ? (
                <Button
                  isIconOnly
                  variant="flat"
                  onPress={() => setContent([...links, ''].toString())}
                >
                  <Plus className="size-4" />
                </Button>
              ) : (
                <Button
                  isIconOnly
                  variant="flat"
                  color="danger"
                  onPress={() => {
                    const newLinks = links.filter((_, i) => i !== index)
                    setContent(newLinks.toString())
                  }}
                >
                  <X className="size-4" />
                </Button>
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
