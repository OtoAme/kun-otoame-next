'use client'

import { useId, useRef, useState, type PointerEvent } from 'react'
import { ChevronDown } from 'lucide-react'
import { Button } from '~/components/dashboard/ui/button'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '~/components/dashboard/ui/dropdown-menu'
import { cn } from '~/lib/dashboard/utils'

const TOUCH_SCROLL_TOLERANCE_PX = 10

const isTouchLike = (pointerType: string) =>
  pointerType === 'touch' || pointerType === 'pen'

export interface WorkspaceMultiSelectOption {
  value: string
  label: string
  description?: string
}

export interface WorkspaceMultiSelectGroup {
  key: string
  title: string
  options: WorkspaceMultiSelectOption[]
}

/**
 * Grouped multi-select on DropdownMenuCheckboxItem. The trigger button shows
 * the selected labels as a summary and the menu stays keyboard operable.
 */
export function WorkspaceMultiSelect({
  label,
  triggerLabel,
  options,
  groups,
  selected,
  disabled,
  onChange,
  placeholder = '请选择',
  required = false
}: {
  label: string
  /** Accessible name of the trigger button; defaults to `label`. */
  triggerLabel?: string
  options?: WorkspaceMultiSelectOption[]
  groups?: WorkspaceMultiSelectGroup[]
  selected: string[]
  disabled?: boolean
  onChange: (values: string[]) => void
  placeholder?: string
  /**
   * Visible required marker, linked with aria-describedby.
   * The trigger stays a menu button, so it does not use aria-required.
   */
  required?: boolean
}) {
  const requiredId = useId()
  const [open, setOpen] = useState(false)
  const touchOrigin = useRef<{ x: number; y: number } | null>(null)
  const touchMoved = useRef(false)
  const flat = groups
    ? groups.flatMap((group) => group.options)
    : (options ?? [])
  const summary = selected.length
    ? flat
        .filter((option) => selected.includes(option.value))
        .map((option) => option.label)
        .join('、')
    : placeholder

  const toggle = (value: string) => {
    onChange(
      selected.includes(value)
        ? selected.filter((item) => item !== value)
        : [...selected, value]
    )
  }

  const renderOptions = (items: WorkspaceMultiSelectOption[]) =>
    items.map((option) => (
      <DropdownMenuCheckboxItem
        key={option.value}
        checked={selected.includes(option.value)}
        onSelect={(event) => event.preventDefault()}
        onCheckedChange={() => toggle(option.value)}
      >
        <span className="flex min-w-0 flex-col">
          <span>{option.label}</span>
          {option.description ? (
            <span
              title={option.description}
              className="whitespace-normal break-words text-xs text-muted-foreground"
            >
              {option.description}
            </span>
          ) : null}
        </span>
      </DropdownMenuCheckboxItem>
    ))

  const rememberTouch = (event: PointerEvent<HTMLButtonElement>) => {
    touchOrigin.current = { x: event.clientX, y: event.clientY }
    touchMoved.current = false
  }

  const noteTouchMove = (event: PointerEvent<HTMLButtonElement>) => {
    const origin = touchOrigin.current
    if (!origin) return
    if (
      Math.abs(event.clientX - origin.x) > TOUCH_SCROLL_TOLERANCE_PX ||
      Math.abs(event.clientY - origin.y) > TOUCH_SCROLL_TOLERANCE_PX
    ) {
      touchMoved.current = true
    }
  }

  const finishTouch = (event: PointerEvent<HTMLButtonElement>) => {
    if (!isTouchLike(event.pointerType) || !touchOrigin.current) return
    const moved = touchMoved.current
    touchOrigin.current = null
    touchMoved.current = false
    if (!moved && !disabled) setOpen((current) => !current)
  }

  return (
    <div className="grid min-w-0 gap-1 text-sm">
      <span>
        {label}
        {required ? (
          <span id={requiredId} className="text-destructive">
            {' '}
            必填
          </span>
        ) : null}
      </span>
      <DropdownMenu open={open} onOpenChange={setOpen}>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="outline"
            disabled={disabled}
            aria-label={triggerLabel ?? label}
            aria-describedby={required ? requiredId : undefined}
            className={cn(
              'h-auto min-h-9 w-full justify-between gap-2 font-normal touch-pan-y',
              !selected.length && 'text-muted-foreground'
            )}
            onPointerDown={(event) => {
              if (!isTouchLike(event.pointerType)) return
              // DropdownMenu toggles on pointerdown for every pointer. Select
              // waits for a click on touch, so a scroll does not open it.
              event.preventDefault()
              const target = event.currentTarget
              if (
                typeof target.hasPointerCapture === 'function' &&
                target.hasPointerCapture(event.pointerId)
              ) {
                target.releasePointerCapture(event.pointerId)
              }
              rememberTouch(event)
            }}
            onPointerMove={noteTouchMove}
            onPointerUp={finishTouch}
            onPointerCancel={() => {
              touchOrigin.current = null
              touchMoved.current = false
            }}
          >
            <span className="min-w-0 flex-1 truncate text-left">{summary}</span>
            <ChevronDown className="size-4 shrink-0" aria-hidden />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          className="w-72 max-w-[min(24rem,calc(100vw-2rem))]"
          align="start"
        >
          {groups
            ? groups.map((group, index) => (
                <DropdownMenuGroup key={group.key}>
                  {index > 0 ? <DropdownMenuSeparator /> : null}
                  <DropdownMenuLabel>{group.title}</DropdownMenuLabel>
                  {renderOptions(group.options)}
                </DropdownMenuGroup>
              ))
            : renderOptions(flat)}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
