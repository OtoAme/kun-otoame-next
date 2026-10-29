'use client'

import { Button } from '@heroui/button'
import { Chip } from '@heroui/chip'
import { Input } from '@heroui/input'
import { Plus, X } from 'lucide-react'
import {
  HELP_GAME_LINK_MAX,
  HELP_GAME_LINK_MAX_LENGTH,
  describeHelpGameLink,
  isHttpUrl
} from '~/utils/helpGameLinks'

interface Props {
  links: string[]
  onChange: (links: string[]) => void
  isDisabled?: boolean
}

/**
 * Optional reference pages for a game the site does not have yet. Any page
 * works; VNDB, Bangumi and Steam links are recognised and labelled so
 * answerers can tell which game is meant.
 */
export const HelpGameLinksInput = ({ links, onChange, isDisabled }: Props) => {
  const rows = links.length ? links : ['']
  const update = (index: number, value: string) =>
    onChange(rows.map((link, i) => (i === index ? value : link)))
  const remove = (index: number) => onChange(rows.filter((_, i) => i !== index))

  return (
    <div className="space-y-2">
      <p className="text-xs text-default-500">
        资料链接（可选）：贴上 VNDB、Bangumi、Steam
        或游戏官网等页面，方便大家确认是哪部游戏，最多 {HELP_GAME_LINK_MAX} 个。
      </p>
      {rows.map((link, index) => {
        const value = link.trim()
        const valid = !value || isHttpUrl(value)
        return (
          <div key={index} className="flex items-start gap-2">
            <Input
              aria-label={`资料链接 ${index + 1}`}
              placeholder="https://vndb.org/v12345"
              size="sm"
              value={link}
              maxLength={HELP_GAME_LINK_MAX_LENGTH}
              isDisabled={isDisabled}
              isInvalid={!valid}
              errorMessage={
                valid ? undefined : '请填写以 http:// 或 https:// 开头的链接'
              }
              onValueChange={(next) => update(index, next)}
              endContent={
                value && valid ? (
                  <Chip size="sm" variant="flat" className="shrink-0">
                    {describeHelpGameLink(value).label}
                  </Chip>
                ) : null
              }
            />
            {(rows.length > 1 || value) && (
              <Button
                isIconOnly
                size="sm"
                variant="light"
                aria-label={`删除资料链接 ${index + 1}`}
                isDisabled={isDisabled}
                onPress={() => remove(index)}
              >
                <X className="size-4" />
              </Button>
            )}
          </div>
        )
      })}
      {rows.length < HELP_GAME_LINK_MAX && rows[rows.length - 1].trim() && (
        <Button
          size="sm"
          variant="light"
          startContent={<Plus className="size-4" />}
          isDisabled={isDisabled}
          onPress={() => onChange([...rows, ''])}
        >
          再加一个链接
        </Button>
      )}
    </div>
  )
}
