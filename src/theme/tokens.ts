/**
 * Design tokens pulled from blendit-app-design.html.
 * Every value below is copied exactly from that file's CSS — not rounded
 * or snapped to a generic scale — so the app matches the mockup precisely.
 */

// :root custom properties in the mockup
export const colors = {
  navy: '#12385F', // --navy — primary brand color, buttons, headings, wordmark
  navyDark: '#0C2842', // --navy-d
  blue: '#3B6FE0', // --blue — accent, "the group wants this"
  blueSoft: '#EAF0FC', // --blue-soft
  chip: '#A6B6C6', // --chip
  fill: '#F1F3F5', // --fill
  line: '#E4E7EB', // --line — hairline borders
  lineSoft: '#EDEFF2', // --line-2
  text: '#16202B', // --text — primary text
  muted: '#6E7B89', // --muted — secondary text
  mutedSoft: '#93A0AD', // --muted-2
  white: '#FFFFFF', // --white — screen surface (.screen background)
  background: '#EEF0F3', // mockup canvas background (body)
} as const;

// Flat placeholder-photo block colors (.f1–.f6), used for trip thumbnails
export const photoBlocks = ['#C6D4E6', '#A9BFDA', '#8CA8CB', '#DAE2ED', '#6F8FBC', '#B8C9DF'] as const;

// font-family: 'Inter',...  and  'Instrument Serif',...
// Each weight loads as its own named family via @expo-google-fonts.
export const fontFamily = {
  regular: 'Inter_400Regular',
  medium: 'Inter_500Medium',
  semibold: 'Inter_600SemiBold',
  bold: 'Inter_700Bold',
  serif: 'InstrumentSerif_400Regular', // .mark / masthead h1
  serifItalic: 'InstrumentSerif_400Regular_Italic',
} as const;

// Distinct font-size declarations from the mockup CSS
export const fontSize = {
  xs: 11.5, // .eyebrow
  sm: 12, // .label, .mcard .k
  smd: 12.5, // .fld label
  md: 13.5, // .masthead p, .sheet .lede, .hero .cr b
  base: 15, // .inp, .btn
  lg: 17, // .slot .ttl
  xl: 19, // .sheet h3
  xxl: 21, // .pro h2
  heading: 24, // h2.t
  logo: 29, // .mark ("blendit" wordmark)
  display: 40, // scaled down from the mockup's clamp(36px, 5vw, 60px) h1
} as const;

// Distinct padding / margin / gap declarations from the mockup CSS
export const spacing = {
  xs: 4, // .dot, swatch icon radius-adjacent gaps
  sm: 6, // label margin-bottom
  md: 9, // .inp gap, unlock icons gap
  lg: 12, // .card margin-bottom, row gaps
  xl: 14, // .fld margin-bottom, .btn padding
  xxl: 18, // .hdr / .chips / .sec horizontal padding — canonical screen margin
  xxxl: 24, // .swatches margin-top
} as const;

// Distinct border-radius declarations from the mockup CSS
export const radii = {
  sm: 5, // .tag
  md: 9, // .inp, .btn
  lg: 12, // .card, .bl, .fc
  xl: 16, // .sheet top corners
  full: 999, // pills / chips / circular avatars
} as const;
