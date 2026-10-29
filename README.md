# CSS Tint filter

Tint elements by an RGB color with CSS filters.

Multiplying an element by a color, like a sprite tint, has no CSS filter. This package fits a chain of standard filter functions that approximates it, so it works on any element and animates with plain CSS.

[Live demo](https://k-adam.github.io/css-tint-filter/)

```sh
npm install css-tint-filter
```

```js
import { multiplyFilter } from "css-tint-filter";

const { css, error } = multiplyFilter([1, 0.45, 0.35]);
element.style.filter = css;
// brightness(..) hue-rotate(..rad) sepia(..) hue-rotate(..rad) saturate(..) brightness(..)
```

## You may not need this

A tint that doesn't animate is exact with an SVG filter, `filter: url(#tint)`:

```html
<svg width="0" height="0">
  <filter id="tint" color-interpolation-filters="sRGB">
    <feColorMatrix values="1 0 0 0 0  0 0.45 0 0 0  0 0 0.35 0 0  0 0 0 1 0" />
  </filter>
</svg>
```

This package is for tints that animate, alone or alongside other filters.

## API

| Export                                       | Description                                                                                                                                                                                                                                     |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `multiplyFilter(rgb, { near, minPrescale })` | Fits the chain for an sRGB color in 0-1. Returns `css`, its six arguments and `error`, the RMS difference from an exact multiply. `near` continues from a neighboring fit; `minPrescale` (default 0.05) trades accuracy for less 8 bit banding. |
| `multiplyKeyframes(from, to)`                | Keyframes `{ offset, filter }[]` from one color to another, with keys where the browser's interpolation would drift off color. Play with `linear` timing.                                                                                       |

## Accuracy and cost

- On muted texture colors a fit is off by about 5/255 RMS, up to 15/255 for strong blues. Saturated pixels fare worse: sepia, the only filter that colors gray, first reduces each pixel to roughly its luminance.
- A fit takes about 20 ms (2 ms with `near`), keyframes up to 0.2 s. Cache the results rather than fitting per frame.
- Firefox and WebKit keep 8 bits between filter functions, Chromium uses float. Fits are scored by the worse of the two.

## Prior art

[This Stack Overflow answer](https://stackoverflow.com/a/43960991), its [CodePen](https://codepen.io/sosuke/pen/Pjoqqp) and [hex-to-css-filter](https://www.npmjs.com/package/hex-to-css-filter) fit filters that turn black into a color, which flattens images. This package fits a multiply instead, so images keep their detail, and adds keyframes for animation.

## Development

`npm run dev` serves the demo. `npm test` runs the unit and Chromium tests, after `npx playwright install chromium`.
