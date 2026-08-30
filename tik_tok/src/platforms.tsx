import type { ReactNode } from 'react'

type IconProps = { className?: string }

function Svg({ className, children, viewBox = '0 0 24 24' }: IconProps & { children: ReactNode; viewBox?: string }) {
  return (
    <svg className={className} viewBox={viewBox} aria-hidden fill="currentColor">
      {children}
    </svg>
  )
}

const icons: Record<string, (p: IconProps) => ReactNode> = {
  youtube: (p) => (
    <Svg {...p}>
      <path d="M23.5 6.2a3 3 0 0 0-2.1-2.2C19.5 3.5 12 3.5 12 3.5s-7.5 0-9.4.5A3 3 0 0 0 .5 6.2 31.6 31.6 0 0 0 0 12a31.6 31.6 0 0 0 .5 5.8 3 3 0 0 0 2.1 2.2c1.9.5 9.4.5 9.4.5s7.5 0 9.4-.5a3 3 0 0 0 2.1-2.2A31.6 31.6 0 0 0 24 12a31.6 31.6 0 0 0-.5-5.8zM9.8 15.5v-7l6.2 3.5-6.2 3.5z" />
    </Svg>
  ),
  tiktok: (p) => (
    <Svg {...p}>
      <path d="M16.6 4.2c1.1 1 2.5 1.7 4.1 1.8v3.3a8.7 8.7 0 0 1-4.1-1.1v6.6a6.8 6.8 0 1 1-6.8-6.8c.3 0 .6 0 .9.1v3.5a3.4 3.4 0 1 0 2.4 3.2V3h3.5v1.2z" />
    </Svg>
  ),
  instagram: (p) => (
    <Svg {...p}>
      <path d="M12 7a5 5 0 1 0 0 10 5 5 0 0 0 0-10zm0 8.2A3.2 3.2 0 1 1 12 8.8a3.2 3.2 0 0 1 0 6.4zm6.4-8.5a1.2 1.2 0 1 1-2.4 0 1.2 1.2 0 0 1 2.4 0zM12 4.4c2 0 2.3 0 3.1.1.7 0 1.1.2 1.4.3.4.1.6.3.9.6.3.3.5.5.6.9.1.3.2.7.3 1.4.1.8.1 1 .1 3.1s0 2.3-.1 3.1c0 .7-.2 1.1-.3 1.4-.1.4-.3.6-.6.9-.3.3-.5.5-.9.6-.3.1-.7.2-1.4.3-.8.1-1 .1-3.1.1s-2.3 0-3.1-.1c-.7 0-1.1-.2-1.4-.3-.4-.1-.6-.3-.9-.6-.3-.3-.5-.5-.6-.9-.1-.3-.2-.7-.3-1.4C4.4 14.3 4.4 14 4.4 12s0-2.3.1-3.1c0-.7.2-1.1.3-1.4.1-.4.3-.6.6-.9.3-.3.5-.5.9-.6.3-.1.7-.2 1.4-.3C9.7 4.4 10 4.4 12 4.4M12 2.5c-2.1 0-2.3 0-3.2.1-.8 0-1.4.2-1.9.4a4 4 0 0 0-1.5 1 4 4 0 0 0 1 1.4c-.2.5-.3 1.1-.4 1.9C4 9.7 4 10 4 12s0 2.3.1 3.2c0 .8.2 1.4.4 1.9a4 4 0 0 0 1 1.5 4 4 0 0 0 1.4 1c.5.2 1.1.3 1.9.4 1 .1 1.1.1 3.2.1s2.3 0 3.2-.1c.8 0 1.4-.2 1.9-.4a4 4 0 0 0 1.5-1 4 4 0 0 0 1-1.4c.2-.5.3-1.1.4-1.9.1-1 .1-1.1.1-3.2s0-2.3-.1-3.2c0-.8-.2-1.4-.4-1.9a4 4 0 0 0-1-1.5 4 4 0 0 0-1.4-1c-.5-.2-1.1-.3-1.9-.4C14.3 2.5 14.1 2.5 12 2.5z" />
    </Svg>
  ),
  pinterest: (p) => (
    <Svg {...p}>
      <path d="M12 2C6.5 2 2 6.5 2 12c0 4.2 2.6 7.8 6.3 9.2-.1-.8-.2-2 0-2.8l1.4-5.8s-.3-.7-.3-1.8c0-1.6 1-2.9 2.1-2.9 1 0 1.5.8 1.5 1.7 0 1-.6 2.6-.9 4-.3 1.2.6 2.2 1.7 2.2 2.1 0 3.5-2.7 3.5-5.8 0-2.4-1.6-4.2-4.5-4.2-3.3 0-5.3 2.4-5.3 5.1 0 .9.3 1.9.7 2.5.1.1.1.2.1.3l-.3 1c0 .2-.2.3-.4.2-1.5-.6-2.2-2.3-2.2-4.1C4.2 8.2 6.8 5 12.2 5c4.3 0 7.1 3.1 7.1 6.4 0 4.4-2.4 7.7-6.1 7.7-1.2 0-2.4-.7-2.8-1.4l-.8 2.9c-.3 1-1 2.2-1.5 3A10.1 10.1 0 0 0 12 22c5.5 0 10-4.5 10-10S17.5 2 12 2z" />
    </Svg>
  ),
  facebook: (p) => (
    <Svg {...p}>
      <path d="M14.2 22V12.8h3.1l.5-3.5h-3.6V7.1c0-1 .3-1.7 1.8-1.7h1.9V2.2C17.5 2.1 16.3 2 15 2c-2.7 0-4.6 1.7-4.6 4.7v2.6H7.3v3.5h3.1V22h3.8z" />
    </Svg>
  ),
  twitter: (p) => (
    <Svg {...p}>
      <path d="M14.5 10.3 22.2 1.5h-1.8l-6.7 7.6L8.3 1.5H1.6l8.1 11.5L1.6 22.5h1.8l7.1-8.1 5.6 8.1h6.7l-8.3-12.2zm-2.5 2.9-1-1.3-6.5-8.6h2.8l5.2 6.9 1 1.3 6.8 9h-2.8l-5.5-7.3z" />
    </Svg>
  ),
}

export const PLATFORM_CATALOG: { id: string; aliases: string[]; label: string; color: string }[] = [
  { id: 'youtube', aliases: ['youtube'], label: 'YouTube', color: '#ff0033' },
  { id: 'tiktok', aliases: ['tiktok'], label: 'TikTok', color: '#69c9d0' },
  { id: 'instagram', aliases: ['instagram'], label: 'Instagram', color: '#e1306c' },
  { id: 'pinterest', aliases: ['pinterest'], label: 'Pinterest', color: '#e60023' },
  { id: 'facebook', aliases: ['facebook'], label: 'Facebook', color: '#1877f2' },
  { id: 'twitter', aliases: ['twitter', 'x'], label: 'X', color: '#e7e9ea' },
]

export const DEFAULT_PLATFORM_IDS = PLATFORM_CATALOG.map((p) => p.id)

export function PlatformIcon({ id, className }: { id: string; className?: string }) {
  const key = id.toLowerCase().replace(/\s+clips$/, '').trim()
  const Icon = icons[key] || icons.twitter
  return <Icon className={className} />
}

export function resolvePlatform(id: string) {
  const key = id.toLowerCase()
  return (
    PLATFORM_CATALOG.find((p) => p.aliases.includes(key) || p.id === key) || {
      id: key,
      aliases: [key],
      label: id,
      color: '#a1a1aa',
    }
  )
}
