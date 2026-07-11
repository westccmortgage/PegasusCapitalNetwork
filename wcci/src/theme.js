// ─────────────────────────────────────────────────────────────────────────────
// WCCI DESIGN TOKENS — CaliforniaMTG-inspired warm concierge palette.
//
// Direction: warm ivory / stone backgrounds, soft cream panels, muted
// bronze/gold accents, deep espresso text, subtle warm-gray borders. Calm,
// premium, mortgage-concierge — not a cold "AI app".
//
// App.jsx's legacy inline styles use the raw hex VALUES below (kept in sync);
// components import { C } and reference the tokens directly.
// ─────────────────────────────────────────────────────────────────────────────
export const C = {
  // Backgrounds
  appBg: '#f6f1e8',       // warm ivory (app canvas)
  card: '#fffdf8',        // soft cream (raised cards)
  panelBg: '#f3ede1',     // light sand (right-side panel / asides)
  surface: '#fbf6ec',     // input / secondary surface
  sand: '#f0e9db',        // muted sand chips / wells
  sand2: '#f3ecdf',       // lighter sand
  accentWash: '#f5ecda',  // gold wash (badges, hovers)

  // Text
  text: '#2f2a23',        // deep espresso (primary)
  textStrong: '#3a3026',  // near-black warm (headings on light)
  textSoft: '#8c8375',    // muted warm gray (secondary)
  textFaint: '#a99e8b',   // faint warm gray (labels, captions)
  disabled: '#cec3ae',    // disabled / placeholder

  // Accent / CTA (muted bronze / gold)
  accent: '#a97b3f',
  accentDeep: '#855f2c',  // hover / gradient partner
  accentSoft: '#d8c4a0',  // soft accent border
  onAccent: '#fffdf8',    // text on accent

  // Borders / dividers (warm gray)
  border: '#e7ddc9',
  borderSoft: '#efe8da',

  // Status (softened, on-palette)
  success: '#5f8a5c',
  successBg: '#eaf1e6',
  warnBg: '#f7ecd6',
  warnBorder: '#e3c489',
  warnText: '#8a5a2f',
  danger: '#b4553f',

  // Effects
  focus: 'rgba(169,123,63,0.28)',
  shadow: 'rgba(74,58,32,0.12)',
  shadowStrong: 'rgba(74,58,32,0.16)',

  // Gradients (bronze)
  grad: 'linear-gradient(135deg, #a97b3f, #855f2c)',
  gradDeep: 'linear-gradient(135deg, #3a3026, #a97b3f)',
};

export default C;
