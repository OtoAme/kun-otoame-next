import { CardHeader } from '@heroui/card'
import type { ReactNode } from 'react'

export const SettingsCardHeader = ({ children }: { children: ReactNode }) => (
  <CardHeader className="pb-4">
    <h2 className="text-xl font-medium">{children}</h2>
  </CardHeader>
)

export const SettingsGroup = ({
  title,
  children
}: {
  title: string
  children: ReactNode
}) => (
  <fieldset className="grid min-w-0 gap-y-2 text-sm">
    <legend className="mb-4 text-base font-semibold text-foreground">
      {title}
    </legend>
    {children}
  </fieldset>
)
