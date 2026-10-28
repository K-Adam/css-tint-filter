import "@picocss/pico";
import "./style.css";
import { multiplyFilter, multiplyKeyframes } from "../src/multiplyFilter.ts";

const $ = (id) => document.getElementById(id);
const rgbOf = (hex) =>
  [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
const matrix = ([r, g, b]) =>
  `${r} 0 0 0 0 0 ${g} 0 0 0 0 0 ${b} 0 0 0 0 0 1 0`;

$("image").addEventListener("change", () =>
  document.body.classList.toggle("wheel", $("image").value === "wheel"),
);

function tint() {
  const color = rgbOf($("color").value);
  const start = performance.now();
  const fit = multiplyFilter(color);
  const ms = performance.now() - start;
  $("exact-static").setAttribute("values", matrix(color));
  $("fitted").style.filter = fit.css;
  $("css").textContent = `filter: ${fit.css};`;
  $("stats").textContent =
    `Fitted in ${ms.toFixed(0)} ms. ` +
    `RMS error ${(fit.error * 255).toFixed(1)}/255 on muted colors; saturated pixels differ more.`;
}

for (const hex of ["#ff7359", "#ffd84d", "#59c26b", "#4da3ff", "#b07cff"]) {
  const button = document.createElement("button");
  button.type = "button";
  button.style.background = hex;
  button.ariaLabel = hex;
  button.addEventListener("click", () => {
    $("color").value = hex;
    tint();
  });
  $("presets").append(button);
}
$("color").addEventListener("input", tint);
$("copy").addEventListener("click", () =>
  navigator.clipboard.writeText($("css").textContent),
);
tint();

// One clock for all three panels: the CSS animations stay paused and every
// frame sets their time, along with the exact filter's matrix
const PERIOD = 4000;
let animations = [];
let from;
let to;
let playing;
let time = 0;
let last = performance.now();

function keyframes() {
  [from, to] = [rgbOf($("from").value), rgbOf($("to").value)];
  const keys = multiplyKeyframes(from, to).map((k) => ({
    offset: k.offset,
    filter: k.filter.css,
  }));
  const timing = { duration: PERIOD, easing: "linear", fill: "both" };
  for (const animation of animations) animation.cancel();
  animations = [
    $("keyed").animate(keys, timing),
    $("naive").animate([keys[0], keys.at(-1)], timing),
  ];
  for (const animation of animations) animation.pause();
  $("keyed-caption").textContent = `Fitted keyframes, ${keys.length} keys`;
}

function frame(now) {
  // The first frame can start before the script did
  if (playing) time = (time + Math.max(0, now - last) / PERIOD) % 2;
  last = now;
  const t = time < 1 ? time : 2 - time;
  for (const animation of animations) animation.currentTime = t * PERIOD;
  $("exact-frame").setAttribute(
    "values",
    matrix(from.map((v, i) => v + t * (to[i] - v))),
  );
  if (playing) $("time").value = t;
  requestAnimationFrame(frame);
}

$("from").addEventListener("change", keyframes);
$("to").addEventListener("change", keyframes);
function setPlaying(value) {
  playing = value;
  $("play").textContent = playing ? "Pause" : "Play";
}

$("play").addEventListener("click", () => setPlaying(!playing));
$("time").addEventListener("input", () => {
  setPlaying(false);
  time = +$("time").value;
});
setPlaying(!matchMedia("(prefers-reduced-motion: reduce)").matches);
keyframes();
requestAnimationFrame(frame);
