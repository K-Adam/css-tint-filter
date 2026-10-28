import { expect, it } from "vitest";
import { commands, page } from "vitest/browser";
import { multiplyFilter, type RGB } from "../src/multiplyFilter.ts";
import { samples, simulate } from "../src/chain.ts";

// The fit's own inputs, in 8 bits as the swatches render them
const inputs = samples.map(
  (x) => x.map((v) => Math.round(v * 255) / 255) as unknown as RGB,
);

const targetLevels = [0, 0.2, 0.4, 0.6, 0.8, 1];
const targets: RGB[] = targetLevels.flatMap((r) =>
  targetLevels.flatMap((g) => targetLevels.map((b): RGB => [r, g, b])),
);

const SWATCH = 4;
const COLS = 25;
const GAP = 10;
const BLOCK_H = (inputs.length / COLS) * SWATCH;
const TILE_W = COLS * SWATCH + GAP;
const TILE_H = 2 * BLOCK_H + GAP;
const PER_ROW = 9;
const PER_BATCH = 72;

const svgNS = "http://www.w3.org/2000/svg";

function swatches(filter: string) {
  const block = document.createElement("div");
  // Composited, as scene elements are, so filters take the GPU path
  block.style.cssText = `display:grid;grid-template-columns:repeat(${COLS},${SWATCH}px);grid-auto-rows:${SWATCH}px;will-change:transform;filter:${filter}`;
  for (const [r, g, b] of inputs) {
    const swatch = document.createElement("div");
    swatch.style.background = `rgb(${r * 255} ${g * 255} ${b * 255})`;
    block.append(swatch);
  }
  return block;
}

function referenceFilter(svg: SVGSVGElement, id: string, [r, g, b]: RGB) {
  const filter = document.createElementNS(svgNS, "filter");
  filter.id = id;
  filter.setAttribute("color-interpolation-filters", "sRGB");
  const matrix = document.createElementNS(svgNS, "feColorMatrix");
  matrix.setAttribute("type", "matrix");
  matrix.setAttribute(
    "values",
    `${r} 0 0 0 0  0 ${g} 0 0 0  0 0 ${b} 0 0  0 0 0 1 0`,
  );
  filter.append(matrix);
  svg.append(filter);
}

async function pixels(element: Element, name: string) {
  const { base64 } = await page.screenshot({
    element,
    path: `__screenshots__/${name}.png`,
    base64: true,
  });
  const image = new Image();
  image.src = `data:image/png;base64,${base64}`;
  await image.decode();
  const context = document.createElement("canvas").getContext("2d")!;
  context.canvas.width = image.width;
  context.canvas.height = image.height;
  context.drawImage(image, 0, 0);
  return context.getImageData(0, 0, image.width, image.height);
}

const rms = (a: number[], b: number[]) =>
  Math.sqrt(a.reduce((s, v, i) => s + (v - b[i]) ** 2, 0) / a.length) / 255;

it("approximates feColorMatrix across the RGB cube", async () => {
  document.body.style.cssText = "margin:0;background:#fff";
  const svg = document.createElementNS(svgNS, "svg");
  svg.setAttribute("width", "0");
  svg.setAttribute("height", "0");
  svg.style.position = "absolute";
  document.body.append(svg);

  const records: {
    target: RGB;
    css: string;
    predicted: number;
    measured: number;
    max: number;
    model: number;
  }[] = [];
  for (let start = 0; start < targets.length; start += PER_BATCH) {
    const batch = targets.slice(start, start + PER_BATCH);
    const filters = batch.map((t) => multiplyFilter(t));
    const sheet = document.createElement("div");
    sheet.style.cssText = `display:grid;grid-template-columns:repeat(${PER_ROW},${TILE_W}px);grid-auto-rows:${TILE_H}px;width:${PER_ROW * TILE_W}px`;
    batch.forEach((target, i) => {
      referenceFilter(svg, `ref${start + i}`, target);
      const tile = document.createElement("div");
      tile.append(swatches(`url(#ref${start + i})`), swatches(filters[i].css));
      sheet.append(tile);
    });
    document.body.append(sheet);
    const image = await pixels(sheet, `sweep-${start / PER_BATCH}`);
    sheet.remove();

    const at = (x: number, y: number) => {
      const o = 4 * (y * image.width + x);
      return [image.data[o], image.data[o + 1], image.data[o + 2]];
    };
    batch.forEach((target, i) => {
      const x0 = (i % PER_ROW) * TILE_W;
      const y0 = Math.floor(i / PER_ROW) * TILE_H;
      const reference: number[] = [];
      const actual: number[] = [];
      const model: number[] = [];
      inputs.forEach((input, j) => {
        const x = x0 + (j % COLS) * SWATCH + SWATCH / 2;
        const y = y0 + Math.floor(j / COLS) * SWATCH + SWATCH / 2;
        reference.push(...at(x, y));
        actual.push(...at(x, y + BLOCK_H));
        model.push(...simulate(filters[i], input).map((v) => v * 255));
      });
      const diffs = actual.map((v, k) => Math.abs(v - reference[k]) / 255);
      records.push({
        target,
        css: filters[i].css,
        predicted: filters[i].error,
        measured: rms(actual, reference),
        max: Math.max(...diffs),
        model: rms(actual, model),
      });
    });
  }

  await commands.writeFile(
    "test/__screenshots__/sweep.json",
    JSON.stringify(records),
  );

  for (const r of records) {
    // The simulator, not just the fit, holds in Chromium
    expect(r.model, r.css).toBeLessThan(1 / 255);
    // Predicted is the worst case, so Chromium may only do better
    expect(r.measured - r.predicted, r.css).toBeLessThan(1 / 255);
    expect(r.measured, r.css).toBeLessThan(20 / 255);
    const [tr, tg, tb] = r.target;
    if (tr === tg && tg === tb)
      expect(r.max, r.css).toBeLessThanOrEqual(2 / 255);
  }
}, 300_000);
