'use client'
import { Card, CardBody, CardHeader } from '@heroui/card'
import { Button } from '@heroui/button'
import { Select, SelectItem } from '@heroui/select'
import { useAccountPreferences } from '~/hooks/useAccountPreferences'
import { editPreference } from '~/utils/preferenceClient'
import { PreferenceActions } from './PreferenceActions'
import type { NsfwMode } from '~/types/api/preferences'
export const BrowsingPreference = () => {
  const state = useAccountPreferences()
  const selected = String(
    state.drafts.nsfw?.value ?? state.snapshot?.items.nsfw.value ?? 'sfw'
  )
  return (
    <Card className="w-full text-sm">
      <CardHeader>
        <h2 className="text-xl font-medium">内容显示</h2>
      </CardHeader>
      <CardBody className="space-y-4">
        <Select
          label="网站内容显示"
          selectedKeys={[selected]}
          disallowEmptySelection
          isDisabled={!state.canEdit}
          onChange={(event) =>
            editPreference('nsfw', event.target.value as NsfwMode)
          }
        >
          <SelectItem key="sfw">仅显示 SFW</SelectItem>
          <SelectItem key="nsfw">仅显示 NSFW</SelectItem>
          <SelectItem key="all">显示全部内容</SelectItem>
        </Select>
        {state.snapshot && !state.snapshot.nsfwSelected && (
          <div className="space-y-2">
            <p>
              账号尚未明确选择，当前使用 SFW。首页最新游戏和最新补丁始终保持
              SFW。
            </p>
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
        <PreferenceActions />
      </CardBody>
    </Card>
  )
}
