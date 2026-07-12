// ─────────────────────────────────────────────────────────────────────────────
// WCCI DESIGN TOKENS — Private Note Capital editorial palette.
//
// Direction: warm paper (cream) backgrounds, near-black "ink" text and accents,
// hairline warm-gray borders, restrained black rectangular CTAs. Quiet,
// editorial, premium finance — monochrome ink on paper, not tech-blue, not
// bronze.
//
// App.jsx's legacy inline styles use the raw hex VALUES below (kept in sync);
// components import { C } and reference the tokens directly.
// ─────────────────────────────────────────────────────────────────────────────
export const C = {
  // Backgrounds
  appBg: '#f2efe7',       // warm paper (app canvas)
  card: '#ffffff',        // clean white card on paper
  panelBg: '#f6f4ee',     // slightly off panel / asides
  surface: '#fbfaf6',     // input / secondary surface
  sand: '#efece3',        // muted paper chips / wells
  sand2: '#efece3',
  accentWash: '#edeae0',  // quiet wash (badges, hovers)

  // Text (ink)
  text: '#171717',        // ink (primary)
  textStrong: '#141414',  // near-black (headings)
  textSoft: '#6f6b62',    // muted warm gray (secondary)
  textFaint: '#9a958a',   // faint warm gray (labels, captions)
  disabled: '#c7c2b6',    // disabled / placeholder

  // Accent / CTA (black ink)
  accent: '#171717',
  accentDeep: '#000000',  // hover / gradient partner
  accentSoft: '#cfc9bc',  // soft border / selected
  onAccent: '#ffffff',    // text on accent

  // Borders / dividers (hairline warm gray)
  border: '#ddd7c9',
  borderSoft: '#e9e4d8',

  // Status (muted, on-palette)
  success: '#5f7d55',
  successBg: '#e9efe3',
  warnBg: '#f4efe1',
  warnBorder: '#d9cfb0',
  warnText: '#6f5a2a',
  danger: '#a23b2a',

  // Effects
  focus: 'rgba(20,20,20,0.20)',
  shadow: 'rgba(20,20,20,0.10)',
  shadowStrong: 'rgba(20,20,20,0.14)',

  // Gradients (near-black ink)
  grad: 'linear-gradient(135deg, #171717, #000000)',
  gradDeep: 'linear-gradient(135deg, #141414, #171717)',
};

export default C;
