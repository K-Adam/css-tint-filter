import {
  clamp,
  clamp8,
  lerp,
  samples,
  throughChain,
  type Chain,
  type RGB,
  type Store,
} from "./chain.ts";

export type { Chain, RGB };

export interface Options {
  // Continue from a neighboring fit, so keyframes interpolate without jumps
  near?: MultiplyFilter;
  // Higher reduces 8 bit flicker, at some accuracy
  minPrescale?: number;
}

export interface MultiplyFilter extends Chain {
  // RMS per channel in 0..1, the worse of float and 8 bit stages
  error: number;
  css: string;
}

// Sepia's brightest row sums to 1.351 on white
const SEPIA_GAIN = 0.351;
const MAX_PRESCALE = 1.5;

// Scaling down early keeps saturate from clipping, which burns strong tints
const prescaleFor = (sepia: number, w: number, min: number) =>
  (min + (MAX_PRESCALE - min) / (1 + Math.exp(-w))) / (1 + SEPIA_GAIN * sepia);

const inputs = Float64Array.from(samples.flat());
const outputs = new Float64Array(inputs.length);

function rmsAfter(target: RGB, brightness: number, store: Store): number {
  let sum = 0;
  for (let i = 0; i < inputs.length; i += 3)
    for (let c = 0; c < 3; c++)
      sum +=
        (store(brightness * outputs[i + c]) - target[c] * inputs[i + c]) ** 2;
  return Math.sqrt(sum / inputs.length);
}

// Expects the float pass in outputs. 8 bit stages posterize a tiny prescale.
function lossAfterFloat(target: RGB, chain: Chain, brightness: number): number {
  const float = rmsAfter(target, brightness, clamp);
  throughChain(chain, inputs, true, outputs);
  return Math.max(float, rmsAfter(target, brightness, clamp8));
}

function chainError(target: RGB, chain: Chain): number {
  throughChain(chain, inputs, false, outputs);
  return lossAfterFloat(target, chain, chain.brightness);
}

// Unbounded search coordinates, so the simplex never sits on a clamped wall
const chainOf = (
  [u, hueIn, hueOut, v, w]: number[],
  minPrescale: number,
): Chain => {
  const p = Math.sin(u) ** 2;
  return {
    prescale: prescaleFor(p, w, minPrescale),
    hueIn,
    sepia: p,
    hueOut,
    saturate: Math.exp(v),
    brightness: 1,
  };
};

// sin² is flat at sepia 0, where a seed from a gray fit would never move
const sepiaCoord = (sepia: number) =>
  Math.max(0.3, Math.asin(Math.sqrt(Math.min(1, sepia))));

const coordsOf = (chain: Chain, minPrescale: number): number[] => {
  const f =
    (chain.prescale * (1 + SEPIA_GAIN * chain.sepia) - minPrescale) /
    (MAX_PRESCALE - minPrescale);
  const g = Math.min(1 - 1e-6, Math.max(1e-6, f));
  return [
    sepiaCoord(chain.sepia),
    chain.hueIn,
    chain.hueOut,
    Math.log(Math.max(1e-3, chain.saturate)),
    Math.log(g / (1 - g)),
  ];
};

// Least squares, ignoring clipping
function fitBrightness(
  target: RGB,
  chain: Chain,
): { chain: Chain; loss: number } {
  throughChain(chain, inputs, false, outputs);
  let ty = 0;
  let yy = 0;
  for (let i = 0; i < inputs.length; i += 3)
    for (let c = 0; c < 3; c++) {
      ty += target[c] * inputs[i + c] * outputs[i + c];
      yy += outputs[i + c] ** 2;
    }
  const brightness = yy ? ty / yy : 0;
  return {
    chain: { ...chain, brightness },
    loss: lossAfterFloat(target, chain, brightness),
  };
}

function nelderMead(
  f: (x: number[]) => number,
  start: number[],
  iterations: number,
): { x: number[]; loss: number } {
  const n = start.length;
  const vertex = (x: number[]) => ({ x, f: f(x) });
  let simplex = [
    start,
    ...start.map((_, i) => start.map((v, j) => v + (i === j ? 0.3 : 0))),
  ].map(vertex);
  const at = (a: number[], b: number[], t: number) =>
    a.map((v, i) => v + t * (b[i] - v));
  for (let iter = 0; iter < iterations; iter++) {
    simplex.sort((a, b) => a.f - b.f);
    const best = simplex[0];
    const worst = simplex[n];
    if (worst.f - best.f < 1e-12) break;
    const centroid = start.map(
      (_, i) => simplex.slice(0, n).reduce((s, p) => s + p.x[i], 0) / n,
    );
    const point = (t: number) => vertex(at(centroid, worst.x, t));
    const reflected = point(-1);
    if (reflected.f < best.f) {
      const expanded = point(-2);
      simplex[n] = expanded.f < reflected.f ? expanded : reflected;
    } else if (reflected.f < simplex[n - 1].f) {
      simplex[n] = reflected;
    } else {
      const contracted = point(0.5);
      if (contracted.f < worst.f) simplex[n] = contracted;
      else
        simplex = simplex.map((p) =>
          p === best ? p : vertex(at(best.x, p.x, 0.5)),
        );
    }
  }
  const { x, f: loss } = simplex.reduce((a, b) => (b.f < a.f ? b : a));
  return { x, loss };
}

const round = (v: number) => Number(v.toFixed(4));

const identity: Chain = {
  prescale: 1,
  hueIn: 0,
  sepia: 0,
  hueOut: 0,
  saturate: 1,
  brightness: 1,
};

const withCss = (target: RGB, chain: Chain): MultiplyFilter => ({
  ...chain,
  error: chainError(target, chain),
  css:
    `brightness(${chain.prescale}) hue-rotate(${chain.hueIn}rad) ` +
    `sepia(${chain.sepia}) hue-rotate(${chain.hueOut}rad) ` +
    `saturate(${chain.saturate}) brightness(${chain.brightness})`,
});

// Hue angle in the plane hue-rotate turns, close enough to seed with
const hueOf = ([r, g, b]: RGB) =>
  Math.atan2(Math.sqrt(3) * (g - b), 2 * r - g - b);

// What the second hue-rotate turns toward the target
const SEPIA_HUE = hueOf([1.351, 1.203, 0.937]);

// Lossy on colorful pixels for strong tints, sepia collapses their hue first
export function multiplyFilter(
  target: RGB,
  { near, minPrescale = 0.05 }: Options = {},
): MultiplyFilter {
  if (!target.every(Number.isFinite))
    throw new RangeError(`Invalid target ${target}`);
  if (!(minPrescale >= 0 && minPrescale < MAX_PRESCALE))
    throw new RangeError(`minPrescale must be in [0, ${MAX_PRESCALE})`);
  const [r, g, b] = target.map(clamp);
  const t: RGB = [r, g, b];
  // Same six functions as any other fit, so keyframes interpolate per function
  if (r === g && g === b && !near)
    return withCss(t, { ...identity, brightness: round(r) });

  const loss = (x: number[]) => fitBrightness(t, chainOf(x, minPrescale)).loss;
  const minimize = (seeds: number[][], iterations = 150) =>
    seeds
      .map((seed) => nelderMead(loss, seed, iterations))
      .reduce((a, b) => (b.loss < a.loss ? b : a));
  const sepias = [sepiaCoord(0.3), Math.PI / 2];
  // Turned toward the target's hue, which finds most tints from two seeds
  const turn = hueOf(t) - SEPIA_HUE;
  const aimed = (iterations?: number) =>
    minimize(
      sepias.map((u) => [u, -turn, turn, 0, 0.5]),
      iterations,
    );
  // Strong tints can sit in another basin, so they try three turns as well
  const fresh = () => {
    const quick = aimed();
    if (quick.loss < 6 / 255) return quick;
    const turns = [0, 1, 2].map((i) => (2 * i * Math.PI) / 3);
    const full = minimize(
      sepias.flatMap((u) => turns.map((a) => [u, -a, a, 0, 0.5])),
    );
    return full.loss < quick.loss ? full : quick;
  };
  let best = near ? minimize([coordsOf(near, minPrescale)], 40) : fresh();
  // A stuck fit shows as error climbing over its neighbor's. Jump out only for
  // a clear gain, since jumps show in animations, less so near gray.
  if (near && best.loss > near.error + 1 / 255) {
    const other = aimed(60);
    const gain = (4 / 255) * Math.min(1, near.sepia / 0.3);
    if (other.loss < best.loss - gain) best = other;
  }

  const fit = fitBrightness(t, chainOf(best.x, minPrescale)).chain;
  // Within half a turn of near, so CSS interpolates the short way
  const wrap = (rad: number, to = 0) =>
    round(to + Math.atan2(Math.sin(rad - to), Math.cos(rad - to)));
  const chain: Chain = {
    prescale: round(fit.prescale),
    hueIn: wrap(fit.hueIn, near?.hueIn),
    sepia: round(fit.sepia),
    hueOut: wrap(fit.hueOut, near?.hueOut),
    saturate: round(fit.saturate),
    brightness: round(fit.brightness),
  };
  return withCss(t, chain);
}

export interface Keyframe {
  offset: number;
  filter: MultiplyFilter;
}

// Animations show 8 bit flicker more
const KEY_MIN_PRESCALE = 0.4;
// Allowed error between keys, above the worse of the two keys' own
const KEY_TOLERANCE = 2 / 255;

const fields = Object.keys(identity) as (keyof Chain)[];

// CSS interpolates each argument of matching filter lists linearly
function interpolates(a: Keyframe, b: Keyframe, from: RGB, to: RGB) {
  const limit = Math.max(a.filter.error, b.filter.error) + KEY_TOLERANCE;
  return [1, 2, 3, 4, 5, 6, 7].every((i) => {
    const u = i / 8;
    const chain = Object.fromEntries(
      fields.map((f) => [f, a.filter[f] + u * (b.filter[f] - a.filter[f])]),
    ) as unknown as Chain;
    const t = a.offset + u * (b.offset - a.offset);
    return chainError(lerp(from, to, t), chain) <= limit;
  });
}

function grayCrossing(from: RGB, to: RGB): number | undefined {
  const chroma = (c: RGB) => {
    const mean = (c[0] + c[1] + c[2]) / 3;
    return c.map((v) => v - mean);
  };
  const d0 = chroma(from);
  const dd = chroma(to).map((v, i) => v - d0[i]);
  const len = dd.reduce((s, v) => s + v * v, 0);
  if (!len) return;
  const t = -dd.reduce((s, v, i) => s + v * d0[i], 0) / len;
  const off = Math.hypot(...d0.map((v, i) => v + t * dd[i]));
  return t > 0 && t < 1 && off < 0.05 ? t : undefined;
}

// Each fit continues from the one before, so neighbors share one parameter path
function fitPath(from: RGB, to: RGB): Keyframe[] {
  const minPrescale = KEY_MIN_PRESCALE;
  const n = Math.max(
    1,
    Math.ceil(Math.hypot(...from.map((v, i) => v - to[i])) / 0.05),
  );
  const keys: Keyframe[] = [
    { offset: 0, filter: multiplyFilter(from, { minPrescale }) },
  ];
  for (let i = 1; i <= n; i++)
    keys.push({
      offset: i / n,
      filter: multiplyFilter(lerp(from, to, i / n), {
        near: keys[i - 1].filter,
        minPrescale,
      }),
    });
  // A start without sepia has no hue to keep, so take its neighbor's angles
  if (keys[0].filter.sepia < 0.05)
    keys[0].filter = multiplyFilter(from, {
      near: keys[1].filter,
      minPrescale,
    });
  return keys;
}

function fewestKeys(path: Keyframe[], from: RGB, to: RGB): Keyframe[] {
  const count = [0];
  const previous = [-1];
  for (let j = 1; j < path.length; j++) {
    count[j] = Infinity;
    for (let i = 0; i < j; i++)
      if (
        count[i] + 1 < count[j] &&
        (i === j - 1 || interpolates(path[i], path[j], from, to))
      ) {
        count[j] = count[i] + 1;
        previous[j] = i;
      }
  }
  const keys: Keyframe[] = [];
  for (let j = path.length - 1; j >= 0; j = previous[j]) keys.unshift(path[j]);
  return keys;
}

// Offsets map linearly from `from` to `to`, so play with linear timing
export function multiplyKeyframes(from: RGB, to: RGB): Keyframe[] {
  const keysAlong = (a: RGB, b: RGB) => fewestKeys(fitPath(a, b), a, b);
  const gray = grayCrossing(from, to);
  if (gray === undefined) return keysAlong(from, to);
  // Sepia is 0 at gray, so each half fits outward from there; fitted from the
  // ends, a half holds strong saturate too long and then jumps. CSS cannot
  // place two keys at one offset, so the right half starts just after.
  const center = lerp(from, to, gray);
  const left = keysAlong(center, from).reverse();
  const right = keysAlong(center, to);
  const start = gray + Math.min(1e-3, (1 - gray) / 2);
  return [
    ...left.map((k) => ({ ...k, offset: gray * (1 - k.offset) })),
    ...right.map((k) => ({ ...k, offset: start + (1 - start) * k.offset })),
  ];
}
