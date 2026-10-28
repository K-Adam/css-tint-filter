export type RGB = readonly [number, number, number];

// Applied in field order
export interface Chain {
  prescale: number;
  hueIn: number;
  sepia: number;
  hueOut: number;
  saturate: number;
  brightness: number;
}

type Matrix = readonly number[];

export type Store = (v: number) => number;

export const clamp: Store = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
// Some browsers and GPUs keep only 8 bits between filter functions
export const clamp8: Store = (v) => Math.round(clamp(v) * 255) / 255;

export const lerp = (a: RGB, b: RGB, t: number) =>
  a.map((v, i) => v + t * (b[i] - v)) as unknown as RGB;

// Filter Effects 1, shorthand equivalents
const sepia = (a: number): Matrix => {
  const i = 1 - a;
  // prettier-ignore
  return [
    0.393 + 0.607 * i, 0.769 - 0.769 * i, 0.189 - 0.189 * i,
    0.349 - 0.349 * i, 0.686 + 0.314 * i, 0.168 - 0.168 * i,
    0.272 - 0.272 * i, 0.534 - 0.534 * i, 0.131 + 0.869 * i,
  ];
};

const hueRotate = (rad: number): Matrix => {
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  // prettier-ignore
  return [
    0.213 + 0.787 * c - 0.213 * s, 0.715 - 0.715 * c - 0.715 * s, 0.072 - 0.072 * c + 0.928 * s,
    0.213 - 0.213 * c + 0.143 * s, 0.715 + 0.285 * c + 0.14 * s, 0.072 - 0.072 * c - 0.283 * s,
    0.213 - 0.213 * c - 0.787 * s, 0.715 - 0.715 * c + 0.715 * s, 0.072 + 0.928 * c + 0.072 * s,
  ];
};

// prettier-ignore
const saturate = (s: number): Matrix => [
  0.213 + 0.787 * s, 0.715 - 0.715 * s, 0.072 - 0.072 * s,
  0.213 - 0.213 * s, 0.715 + 0.285 * s, 0.072 - 0.072 * s,
  0.213 - 0.213 * s, 0.715 - 0.715 * s, 0.072 + 0.928 * s,
];

// Excludes the last brightness. Hot loop, so clamps are inline.
export function throughChain(
  chain: Chain,
  input: ArrayLike<number>,
  eightBit: boolean,
  out: Float64Array,
): void {
  const stages = [
    hueRotate(chain.hueIn),
    sepia(chain.sepia),
    hueRotate(chain.hueOut),
    saturate(chain.saturate),
  ];
  const k = chain.prescale;
  for (let i = 0; i < input.length; i += 3) {
    let r = k * input[i];
    let g = k * input[i + 1];
    let b = k * input[i + 2];
    for (let j = -1; j < stages.length; j++) {
      if (j >= 0) {
        const m = stages[j];
        const R = m[0] * r + m[1] * g + m[2] * b;
        const G = m[3] * r + m[4] * g + m[5] * b;
        b = m[6] * r + m[7] * g + m[8] * b;
        r = R;
        g = G;
      }
      r = r < 0 ? 0 : r > 1 ? 1 : r;
      g = g < 0 ? 0 : g > 1 ? 1 : g;
      b = b < 0 ? 0 : b > 1 ? 1 : b;
      if (eightBit) {
        r = Math.round(r * 255) / 255;
        g = Math.round(g * 255) / 255;
        b = Math.round(b * 255) / 255;
      }
    }
    out[i] = r;
    out[i + 1] = g;
    out[i + 2] = b;
  }
}

export const simulate = (chain: Chain, rgb: RGB, eightBit = false): RGB => {
  const store = eightBit ? clamp8 : clamp;
  const out = new Float64Array(3);
  throughChain(chain, rgb, eightBit, out);
  const k = chain.brightness;
  return [store(k * out[0]), store(k * out[1]), store(k * out[2])];
};

// Pulled 70% toward gray: textures are mostly muted, and fitting saturated
// inputs costs the tint's hue on everything else
const steps = [0, 0.25, 0.5, 0.75, 1];
export const samples: readonly RGB[] = steps.flatMap((r) =>
  steps.flatMap((g) =>
    steps.map((b): RGB => {
      const y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      return lerp([y, y, y], [r, g, b], 0.3);
    }),
  ),
);
