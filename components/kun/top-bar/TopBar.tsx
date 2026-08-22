'use client'

import { useEffect, useState } from 'react'
import {
  Navbar,
  NavbarContent,
  NavbarItem,
  NavbarMenuToggle
} from '@heroui/navbar'
import Link from 'next/link'
import { KunTopBarBrand } from './Brand'
import { KunTopBarUser } from './User'
import { usePathname } from 'next/navigation'
import { getKunMobileNavItems, getKunNavItems } from '~/constants/top-bar'
import { KunMobileMenu } from './KunMobileMenu'
import { useUserStore } from '~/store/userStore'
import { useMounted } from '~/hooks/useMounted'

export const KunTopBar = () => {
  const pathname = usePathname()
  const [isMenuOpen, setIsMenuOpen] = useState(false)
  const user = useUserStore((state) => state.user)
  const isMounted = useMounted()
  const navigationRole = isMounted && user.uid ? user.role : 1
  const navItems = getKunNavItems(navigationRole)
  const mobileNavItems = getKunMobileNavItems(navigationRole)

  useEffect(() => {
    setIsMenuOpen(false)
  }, [pathname])

  return (
    <Navbar
      maxWidth="xl"
      isMenuOpen={isMenuOpen}
      onMenuOpenChange={setIsMenuOpen}
      classNames={{ base: 'kun-top-bar', wrapper: 'px-3 sm:px-6' }}
    >
      <NavbarContent className="sm:hidden" justify="start">
        <li className="h-full">
          <NavbarMenuToggle />
        </li>
      </NavbarContent>

      <div className="flex items-center gap-2">
        <KunTopBarBrand />

        <NavbarContent className="hidden gap-3 sm:flex">
          {navItems.map((item) => {
            const isActive =
              pathname === item.href ||
              (item.href === '/admin' && pathname.startsWith('/admin/'))

            return (
              <NavbarItem key={item.href} isActive={isActive}>
                <Link
                  className={
                    isActive
                      ? 'kun-top-nav-link text-primary'
                      : 'kun-top-nav-link text-foreground'
                  }
                  href={item.href}
                >
                  {item.name}
                </Link>
              </NavbarItem>
            )
          })}
        </NavbarContent>
      </div>

      <KunTopBarUser />

      <KunMobileMenu items={mobileNavItems} />
    </Navbar>
  )
}
