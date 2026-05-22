'use client'

import { useMemo, useState, type ComponentType } from 'react'
import { useTheme } from 'next-themes'
import { Button, Popover, PopoverContent, PopoverTrigger } from '@heroui/react'
import { Check, Moon, Palette, Sparkles, Sun, SunMoon } from 'lucide-react'
import {
  KUN_SELECTABLE_SITE_THEMES,
  KUN_SITE_THEME_REGISTRY
} from '~/constants/theme'
import { useKunSiteTheme } from '~/hooks/useKunSiteTheme'
import { useMounted } from '~/hooks/useMounted'
import { cn } from '~/utils/cn'

enum DisplayMode {
  dark = 'dark',
  light = 'light',
  system = 'system'
}

interface DisplayModeOption {
  id: DisplayMode
  label: string
  icon: ComponentType<{ className?: string }>
}

const displayModeOptions: DisplayModeOption[] = [
  { id: DisplayMode.light, label: '浅色', icon: Sun },
  { id: DisplayMode.dark, label: '深色', icon: Moon },
  { id: DisplayMode.system, label: '跟随系统', icon: SunMoon }
]

const siteThemeOptions = KUN_SELECTABLE_SITE_THEMES.map((id) => ({
  ...KUN_SITE_THEME_REGISTRY[id],
  id
}))

const isDisplayMode = (value: unknown): value is DisplayMode => {
  return (
    value === DisplayMode.light ||
    value === DisplayMode.dark ||
    value === DisplayMode.system
  )
}

export const ThemeSwitcher = () => {
  const { theme: displayMode, setTheme: setDisplayMode } = useTheme()
  const { theme: siteTheme, setTheme: setSiteTheme } = useKunSiteTheme()
  const [isOpen, setIsOpen] = useState(false)
  const isMounted = useMounted()

  const currentDisplayMode = isDisplayMode(displayMode)
    ? displayMode
    : DisplayMode.system
  const shouldRenderOptions = isMounted && isOpen

  const selectedSiteTheme = useMemo(
    () => siteThemeOptions.find((option) => option.id === siteTheme),
    [siteTheme]
  )

  return (
    <Popover
      isOpen={isOpen}
      onOpenChange={setIsOpen}
      placement="bottom-end"
      offset={10}
    >
      <PopoverTrigger>
        <Button
          isIconOnly
          variant="light"
          aria-label="外观设置"
          className="text-default-500"
        >
          <Palette className="size-6" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[280px] max-w-[calc(100vw-24px)] p-0">
        {(titleProps) => (
          <div className="w-full px-3 py-3">
            {shouldRenderOptions ? (
              <div className="flex flex-col gap-4">
                <section className="flex flex-col gap-2">
                  <div
                    className="flex items-center gap-2 text-sm font-medium text-foreground"
                    {...titleProps}
                  >
                    <Sparkles className="size-4 text-primary" />
                    站点主题
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    {siteThemeOptions.map((option) => {
                      const selected = option.id === selectedSiteTheme?.id

                      return (
                        <Button
                          key={option.id}
                          size="sm"
                          variant={selected ? 'flat' : 'light'}
                          color={selected ? 'primary' : 'default'}
                          className="h-10 justify-start gap-2 px-2"
                          aria-pressed={selected}
                          onPress={() => setSiteTheme(option.id)}
                        >
                          <span
                            className="size-3 shrink-0 rounded-full border border-default-200"
                            style={{ backgroundColor: option.previewColor }}
                          />
                          <span className="min-w-0 flex-1 truncate text-left">
                            {option.label}
                          </span>
                          <Check
                            className={cn(
                              'size-4 shrink-0',
                              selected ? 'opacity-100' : 'opacity-0'
                            )}
                          />
                        </Button>
                      )
                    })}
                  </div>
                </section>

                <section className="flex flex-col gap-2">
                  <div className="text-sm font-medium text-foreground">
                    显示模式
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    {displayModeOptions.map((option) => {
                      const selected = option.id === currentDisplayMode
                      const Icon = option.icon

                      return (
                        <Button
                          key={option.id}
                          size="sm"
                          variant={selected ? 'flat' : 'light'}
                          color={selected ? 'primary' : 'default'}
                          className="h-10 min-w-0 flex-col gap-1 px-1"
                          aria-pressed={selected}
                          onPress={() => setDisplayMode(option.id)}
                        >
                          <Icon className="size-4 shrink-0" />
                          <span className="max-w-full truncate text-xs">
                            {option.label}
                          </span>
                        </Button>
                      )
                    })}
                  </div>
                </section>
              </div>
            ) : (
              <div className="h-[132px] w-full" />
            )}
          </div>
        )}
      </PopoverContent>
    </Popover>
  )
}
