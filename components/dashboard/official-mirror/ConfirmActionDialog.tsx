'use client'

import { useEffect, useId, useState } from 'react'
import { Button } from '~/components/dashboard/ui/button'
import { Checkbox } from '~/components/dashboard/ui/checkbox'
import { Label } from '~/components/dashboard/ui/label'
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from '~/components/dashboard/ui/alert-dialog'

export function ConfirmActionDialog({
  open,
  title,
  consequence,
  lines,
  confirmLabel,
  pending,
  error,
  notice,
  tone = 'destructive',
  requireConfirmation,
  onOpenChange,
  onConfirm
}: {
  open: boolean
  title: string
  consequence: string
  /** Further consequence lines shown under the description. */
  lines?: readonly string[]
  confirmLabel: string
  pending: boolean
  error?: string
  notice?: string
  /** `default` for actions that are not destructive, such as reopening. */
  tone?: 'destructive' | 'default'
  /**
   * Label of a checkbox the admin must tick before confirming. It starts
   * unticked every time the dialog opens.
   */
  requireConfirmation?: string
  onOpenChange: (open: boolean) => void
  onConfirm: () => void
}) {
  const checkboxId = useId()
  const [checked, setChecked] = useState(false)
  useEffect(() => {
    if (open) setChecked(false)
  }, [open])
  const blocked = Boolean(requireConfirmation) && !checked

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (!next && pending) return
        onOpenChange(next)
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription className="break-words">
            {consequence}
          </AlertDialogDescription>
        </AlertDialogHeader>
        {lines && lines.length > 0 ? (
          <ul className="flex flex-col gap-1 text-sm text-muted-foreground">
            {lines.map((line) => (
              <li key={line} className="break-words">
                {line}
              </li>
            ))}
          </ul>
        ) : null}
        {requireConfirmation ? (
          <div className="flex items-start gap-2">
            <Checkbox
              id={checkboxId}
              checked={checked}
              disabled={pending}
              onCheckedChange={(value) => setChecked(value === true)}
            />
            <Label htmlFor={checkboxId} className="leading-5">
              {requireConfirmation}
            </Label>
          </div>
        ) : null}
        {notice ? (
          <p role="status" className="text-sm text-muted-foreground">
            {notice}
          </p>
        ) : null}
        {error ? (
          <p role="alert" className="break-all text-sm text-destructive">
            {error}
          </p>
        ) : null}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>取消</AlertDialogCancel>
          <Button
            type="button"
            variant={tone === 'default' ? 'default' : 'destructive'}
            disabled={pending || blocked}
            onClick={() => {
              if (pending || blocked) return
              onConfirm()
            }}
          >
            {pending ? '正在提交…' : confirmLabel}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
