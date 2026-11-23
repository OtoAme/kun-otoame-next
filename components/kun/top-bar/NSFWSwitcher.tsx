'use client'

import {
  Dropdown,
  DropdownItem,
  DropdownMenu,
  DropdownTrigger
} from '@heroui/react'
import { Button } from '@heroui/button'
import { useAccountPreferences } from '~/hooks/useAccountPreferences'
import { editPreference, selectNsfwPreference } from '~/utils/preferenceClient'
import { PreferenceActions } from '~/components/settings/user/PreferenceActions'
import type { NsfwMode } from '~/types/api/preferences'
import { Ban, CircleSlash, ShieldCheck } from 'lucide-react'
import type { JSX } from 'react'

const themeIconMap: Record<string, JSX.Element> = {
  sfw: <ShieldCheck className="size-5" />,
  nsfw: <Ban className="size-5" />,
  all: <CircleSlash className="size-5" />
}

interface Props {
  isOpen?: boolean
  onOpenChange?: (isOpen: boolean) => void
}

export const NSFWSwitcher = ({ isOpen, onOpenChange }: Props) => {
  const state = useAccountPreferences()
  const selected = String(
    state.drafts.nsfw?.value ?? state.snapshot?.items.nsfw.value ?? 'sfw'
  )
  const themeIcon = themeIconMap[selected] || themeIconMap.sfw

  return (
    <div className="space-y-2">
      <Dropdown
        className="min-w-0"
        isOpen={isOpen}
        onOpenChange={onOpenChange}
        shouldCloseOnBlur={false}
      >
        <DropdownTrigger isDisabled={!state.canEdit}>
          <div className="flex items-center justify-between">
            <span>网站内容显示</span>
            <span className="text-default-700">{themeIcon}</span>
          </div>
        </DropdownTrigger>

        <DropdownMenu
          disallowEmptySelection
          selectedKeys={new Set([selected])}
          selectionMode="single"
          onSelectionChange={(key) => {
            void selectNsfwPreference((key.anchorKey ?? 'sfw') as NsfwMode)
          }}
        >
          {['sfw', 'nsfw', 'all'].map((key) => (
            <DropdownItem
              startContent={themeIconMap[key]}
              textValue={key}
              key={key}
              className="text-default-700"
            >
              {key === 'sfw' && '仅显示 SFW (内容安全) 的文章'}
              {key === 'nsfw' && '仅显示 NSFW (可能含有 R18) 的文章'}
              {key === 'all' && '同时显示 SFW 和 NSFW 的文章'}
            </DropdownItem>
          ))}
        </DropdownMenu>
      </Dropdown>
      {state.snapshot && !state.snapshot.nsfwSelected && (
        <div className="space-y-2 text-sm">
          <p>尚未选择账号显示偏好，当前使用 SFW。</p>
          {state.legacyNsfw && (
            <Button
              size="sm"
              onPress={() => editPreference('nsfw', state.legacyNsfw!)}
            >
              导入本机原有选择（{state.legacyNsfw}）
            </Button>
          )}
          <Button size="sm" onPress={() => editPreference('nsfw', 'sfw')}>
            明确使用 SFW
          </Button>
        </div>
      )}
      {!(state.saving && state.snapshot?.nsfwSelected) && (
        <PreferenceActions settingKeys={['nsfw']} />
      )}
    </div>
  )
}
