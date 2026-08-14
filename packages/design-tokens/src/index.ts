export const color = {
  ground: '#FFFFFF',
  white: '#FFFFFF',
  surface: '#F5F5F2',
  hairline: '#E7E7E1',
  ink: '#0A0A0B',
  graphite: '#2E2E33',
  fog: '#6B6B72',
  mute: '#A3A39B',

  accent: '#2563EB',
  accentInk: '#FFFFFF',
  accentStrong: '#1E40AF',
  accentSoft: '#DBEAFE',

  sky1: '#87CEEB',
  sky2: '#98D8E8',
  sky3: '#B0E0E6',
  sky4: '#E0F6FF',

  featureMint: '#16A34A',
  featureTangerine: '#EA580C',
  featureViolet: '#7C3AED',

  success: '#2E5D3C',
  danger: '#DC2F3B',
} as const

export const font = {
  display: "'Space Grotesk', system-ui, sans-serif",
  body: "'Inter', system-ui, sans-serif",
  mono: "'JetBrains Mono', ui-monospace, monospace",
} as const

export const text = {
  label: '11px',
  caption: '12px',
  bodySm: '14px',
  body: '16px',
  titleSm: '20px',
  title: '24px',
  displaySm: '32px',
  display: '44px',
  displayLg: '56px',
  hero: '88px',
} as const

export const weight = {
  regular: 400,
  medium: 500,
  semibold: 600,
  bold: 700,
} as const

export const bp = {
  sm: 390,
  md: 768,
  lg: 1024,
  xl: 1440,
} as const

export const space = {
  1: '4px',
  2: '8px',
  3: '12px',
  4: '16px',
  5: '20px',
  6: '24px',
  8: '32px',
  10: '40px',
  12: '48px',
  16: '64px',
} as const

export const radius = {
  none: '0px',
  xs: '4px',
  sm: '8px',
  md: '12px',
  lg: '20px',
  pill: '999px',
} as const

export type ColorToken = keyof typeof color
export type FontToken = keyof typeof font
export type RadiusToken = keyof typeof radius
export type SpaceToken = keyof typeof space
