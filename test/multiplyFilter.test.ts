import { expect, it } from "vitest";
import {
  multiplyFilter,
  multiplyKeyframes,
  type Chain,
  type RGB,
} from "../src/multiplyFilter.ts";
import { samples, simulate } from "../src/chain.ts";

const identity = {
  prescale: 1,
  hueIn: 0,
  sepia: 0,
  hueOut: 0,
  saturate: 1,
  brightness: 1,
};

it("simulates the spec matrices with a clamp per stage", () => {
  expect(simulate(identity, [0.2, 0.5, 0.9])).toEqual([0.2, 0.5, 0.9]);
  const white = simulate({ ...identity, sepia: 1 }, [1, 1, 1]);
  expect(white[0]).toBe(1);
  expect(white[1]).toBe(1);
  expect(white[2]).toBeCloseTo(0.937);
});

it("multiplies grays exactly with brightness alone", () => {
  const filter = multiplyFilter([0.5, 0.5, 0.5]);
  expect(filter).toMatchObject({ ...identity, brightness: 0.5 });
  // Only 8 bit rounding between stages
  expect(filter.error).toBeLessThan(1 / 255);
  expect(filter.css.match(/\w+(?:-\w+)?\(/g)).toEqual([
    "brightness(",
    "hue-rotate(",
    "sepia(",
    "hue-rotate(",
    "saturate(",
    "brightness(",
  ]);
});

it("rejects invalid input", () => {
  expect(() => multiplyFilter([NaN, 0, 0])).toThrow(RangeError);
  expect(() => multiplyFilter([1, 0, 0], { minPrescale: 1.5 })).toThrow(
    RangeError,
  );
});

it("approximates tints, light ones closely", () => {
  expect(multiplyFilter([0.9, 0.95, 1]).error).toBeLessThan(8 / 255);
  expect(multiplyFilter([1, 0.8, 0.6]).error).toBeLessThan(16 / 255);
  expect(multiplyFilter([1, 0, 0]).error).toBeLessThan(24 / 255);
  expect(multiplyFilter([0, 1, 0]).error).toBeLessThan(16 / 255);
  expect(multiplyFilter([0, 0, 1]).error).toBeLessThan(44 / 255);
});

it("continues from a neighboring fit for animations", () => {
  const red = multiplyFilter([1, 0, 0], { minPrescale: 0.4 });
  expect(red.prescale).toBeGreaterThanOrEqual(0.4 / 1.351);
  const next = multiplyFilter([0.9, 0.04, 0.1], {
    near: red,
    minPrescale: 0.4,
  });
  expect(Math.abs(next.hueIn - red.hueIn)).toBeLessThanOrEqual(Math.PI);
  expect(Math.abs(next.hueOut - red.hueOut)).toBeLessThanOrEqual(Math.PI);
  expect(next.error).toBeLessThan(16 / 255);
});

it("places no keys between close colors", () => {
  const keys = multiplyKeyframes([0.8, 0.6, 0.4], [0.82, 0.6, 0.42]);
  expect(keys.map((k) => k.offset)).toEqual([0, 1]);
});

it("places a key where the path crosses gray", () => {
  const keys = multiplyKeyframes([1, 0.5, 0], [0, 0.5, 1]);
  const gray = keys.find((k) => Math.abs(k.offset - 0.5) < 1e-9);
  expect(gray?.filter.sepia).toBeLessThan(0.05);
}, 30_000);

it("keeps offsets apart when the path crosses gray near its end", () => {
  const offsets = multiplyKeyframes([1, 0, 0], [0.5, 0.5, 0.501]).map(
    (k) => k.offset,
  );
  expect(offsets.at(-1)).toBe(1);
  for (let k = 1; k < offsets.length; k++)
    expect(offsets[k]).toBeGreaterThan(offsets[k - 1]);
}, 30_000);

it("keeps frames between keys as close as the keys", () => {
  const from: RGB = [1, 1, 1];
  const to: RGB = [0, 1, 0];
  const keys = multiplyKeyframes(from, to);
  expect(keys[0].offset).toBe(0);
  expect(keys.at(-1)!.offset).toBe(1);
  const fields = Object.keys(identity) as (keyof Chain)[];
  for (let k = 0; k + 1 < keys.length; k++) {
    const [a, b] = [keys[k], keys[k + 1]];
    expect(b.offset).toBeGreaterThan(a.offset);
    expect(a.filter.error).toBeLessThan(8 / 255);
    for (let u = 0.1; u < 1; u += 0.1) {
      const chain = Object.fromEntries(
        fields.map((f) => [f, a.filter[f] + u * (b.filter[f] - a.filter[f])]),
      ) as unknown as Chain;
      const t = a.offset + u * (b.offset - a.offset);
      const target = from.map((v, i) => v + t * (to[i] - v));
      let sum = 0;
      for (const x of samples) {
        const out = simulate(chain, x, true);
        for (let c = 0; c < 3; c++) sum += (out[c] - target[c] * x[c]) ** 2;
      }
      const error = Math.sqrt(sum / (3 * samples.length));
      const keyError = Math.max(a.filter.error, b.filter.error);
      expect(error).toBeLessThan(keyError + 3 / 255);
    }
  }
}, 30_000);
