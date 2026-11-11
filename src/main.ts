import { decoder, DEFAULTS, type Frame, type Settings } from "./decode";
import source from "./decode.ts?raw";
import {
  ALPHABETS,
  alphabetIn,
  type Case,
  FACES,
  FEELS,
  inCase,
} from "./choices";
import { type Col, colOf, fillCol, fillIndex } from "./ui/build";
import { asCode, copy } from "./ui/copy";
import { calm, EASE, easeHeight, fadeUp, say, track } from "./ui/fx";
import { menus } from "./ui/menus";
import { meter } from "./ui/meter";

const $ = <T extends HTMLElement>(id: string) =>
  document.getElementById(id) as T;

const LINES = [
  "NOTHING MOVES",
  "SIGNAL FOUND",
  "ALMOST LEGIBLE",
  "COPY THAT",
  "STAND BY",
  "OVER AND OUT",
];
const REST = 2200;
// A tap holds the line this long, standing in for you hovering with a mouse.
const TAP_HOLD = 5000;
const MAX = 168;
const MIN = 32;
// Below this the columns are too small to read, so you get the index.
const SMALL = 80;

const sheet = $("sheet");
const stage = $<HTMLButtonElement>("stage");
const line = $("line");
const probe = $("probe");
const cols = $("cols");
const key = $("key");
const status = $("status");
const dock = $("dock");
const index = $("index");
const legend = sheet.querySelector<HTMLElement>(".legend")!;

// Mirror page.scss.
const phone = matchMedia("(max-width: 759px)");
const stacked = matchMedia("(max-width: 999px)");

let settings: Settings = { ...DEFAULTS };
let lettercase: Case = "upper";
const engine = (): Settings => ({
  ...settings,
  alphabet: alphabetIn(settings.alphabet, lettercase),
});
let own: string | null = null;
let next = 0;
let timer = 0;
let running = false;
const decoding = (on: boolean) => {
  running = on;
  cols.classList.toggle("decoding", on);
};
let over = false;
let paused = calm();

let columns: (Col | null)[] = [];
let entries: (Col | null)[] = [];
let geometry: { x: number; w: number }[] = [];
let drawnPools: Frame["pools"] | null = null;
let drawnText = "";
let enteredAt = 0;
let last: Frame | null = null;

// One fitted size for every line, set by the widest, so the sheet holds
// still. `chosen` is a size you pick on the slider.
let chosen: number | null = null;
let indexed = false;
let fitted = MAX;

const wideAt = (t: string) => {
  probe.style.fontSize = `${MAX}px`;
  probe.textContent = t;
  return probe.getBoundingClientRect().width;
};

const halves = (t: string) => {
  const words = t.split(" ");
  let best = wideAt(t);
  for (let k = 1; k < words.length; k++)
    best = Math.min(
      best,
      Math.max(
        wideAt(words.slice(0, k).join(" ")),
        wideAt(words.slice(k).join(" ")),
      ),
    );
  return best;
};

const room = () => Math.min(sheet.clientWidth, dock.offsetWidth);

const fitBy = (measure: (t: string) => number) => {
  const wide = Math.max(
    ...[...LINES, own ?? ""].map((t) => measure(inCase(t, lettercase))),
  );
  return wide ? Math.floor((MAX * room() * 0.98) / wide) : MAX;
};

const fit = () => {
  const one = fitBy(wideAt);
  const split = one < SMALL && stacked.matches;
  sheet.classList.toggle("split", split);
  const size = split ? fitBy(halves) : one;
  fitted = Math.max(MIN, Math.min(MAX, size));
  if (chosen !== null && chosen >= fitted) chosen = null;
};

const cell = () =>
  Math.min(
    28,
    Math.max(
      9,
      Math.min(
        parseFloat(getComputedStyle(line).fontSize) * 0.2,
        innerHeight * 0.024,
      ),
    ),
  );

const rows = () => {
  const size = parseFloat(getComputedStyle(line).fontSize);
  const top = sheet.getBoundingClientRect().top + scrollY;
  // Sheet padding, line, bracket, gaps and legend.
  const space = innerHeight - top - 56 - size * 0.9 - 60 - 46 - 76;
  const fit = Math.floor(space / (cell() * 1.18));
  return Math.max(3, Math.min(12, Math.round(size / 9), fit));
};

const place = (text: string) => {
  const px = chosen ?? fitted;
  document.documentElement.style.setProperty("--line", `${px}px`);
  document.documentElement.style.setProperty("--rows", String(rows()));
  const wraps = (wideAt(text) * px) / MAX > room() * 0.98;
  sheet.classList.toggle("wrapped", wraps);
  // Columns can't sit under two rows, so wrapped or split lines index too.
  const split = sheet.classList.contains("split");
  if (
    sheet.classList.toggle("indexed", px < SMALL || wraps || split) !== indexed
  ) {
    indexed = !indexed;
    if (!focused && !hot) explain();
  }
  const size = $<HTMLInputElement>("size");
  size.max = String(fitted);
  size.value = String(px);
  track(size, px);
  $("size-val").textContent = chosen === null ? "Fit width" : String(px);
  $("size-chip").querySelector<HTMLElement>(".unit")!.hidden = chosen === null;
  $("size-out").textContent = `${px}\u00A0px`;
  size.setAttribute("aria-valuetext", `${px} px`);
  $("fit").hidden = chosen === null;
  $("fitted").hidden = chosen !== null;
};

const measure = () => {
  const face = line.lastElementChild;
  geometry = [];
  if (!face) return;
  const origin = cols.getBoundingClientRect().left;
  const at = (r: DOMRect) => ({ x: r.left - origin + r.width / 2, w: r.width });
  const boxes = face.querySelectorAll<HTMLElement>("[data-i]");
  if (boxes.length)
    for (const box of boxes)
      geometry[Number(box.dataset.i)] = at(box.getBoundingClientRect());
  else if (face.firstChild instanceof Text) {
    const node = face.firstChild;
    const range = document.createRange();
    let off = 0;
    for (const ch of node.data) {
      range.setStart(node, off);
      range.setEnd(node, off + ch.length);
      geometry.push(at(range.getBoundingClientRect()));
      off += ch.length;
    }
  }
  drawnPools = null;
  if (last?.text === d.text) {
    drawColumns(last.pools);
    light(last);
  }
};

let nodes: HTMLElement[] = [];

const drawColumns = (pools: Frame["pools"]) => {
  const now = performance.now();
  if (d.text !== drawnText) enteredAt = now;
  // Only the redraw right after a new line animates; the rest snap.
  const moving = now - enteredAt < 100;
  cols.classList.toggle("instant", !moving);
  drawnPools = pools;
  drawnText = d.text;
  columns = [];
  const tall = rows();
  const size = cell();
  let k = 0;
  pools.forEach((pool, i) => {
    const at = geometry[i];
    if (!pool || !at) return columns.push(null);
    let col = nodes[k];
    const fresh = !col;
    if (fresh) {
      col = document.createElement("div");
      col.className = "col in";
      const w = document.createElement("span");
      w.className = "w";
      col.append(w);
      cols.append(col);
      nodes[k] = col;
    }
    col.classList.toggle("narrow", at.w < 24);
    col.style.transform = `translateX(${at.x}px) translateX(-50%)`;
    col.style.width = `${at.w}px`;
    col.dataset.width = String(Math.round(at.w));
    col.dataset.x = String(at.x);
    col.dataset.w = String(at.w);
    col.querySelector(".w")!.textContent = col.dataset.width;
    col.dataset.letter = [...d.text][i];
    col.dataset.i = String(i);
    const across = Math.max(1, Math.floor((at.w - 6) / (size * 1.25)));
    const short = at.w < 56;
    const key = `${pool.join("")}|${across}|${short}`;
    if (col.dataset.key !== key) {
      col.dataset.key = key;
      const set = fillCol(col, pool, across, short, tall);
      if (!fresh && moving) set.classList.add("swap");
    }
    columns.push(colOf(col));
    k++;
  });
  for (const gone of nodes.slice(k)) {
    gone.classList.add("out");
    // Matches --duration-base.
    setTimeout(() => gone.remove(), 240);
  }
  nodes = nodes.slice(0, k);
  if (!moving) requestAnimationFrame(() => cols.classList.remove("instant"));
  drawIndex(pools);
};

let listed = "";
let listedText = "";
const drawIndex = (pools: Frame["pools"]) => {
  const now = `${d.text}|${pools.map((p, i) => `${p?.join("") ?? ""}:${Math.round(geometry[i]?.w ?? 0)}`).join("|")}`;
  if (now === listed) return;
  listed = now;
  const fresh = d.text !== listedText;
  listedText = d.text;
  easeHeight(index, () => {
    entries = fillIndex(
      index,
      [...d.text],
      pools,
      (i) => geometry[i]?.w ?? 0,
      fresh,
    );
  });
};

const light = (f: Frame) => {
  const shown = [...f.shown];
  const text = [...f.text];
  for (const list of [columns, entries])
    list.forEach((col, i) => {
      if (!col) return;
      const live = f.live[i];
      if (col.live !== live) {
        col.live = live;
        col.el.classList.toggle("live", live);
      }
      const mark = live ? undefined : col.glyphs.get(text[i]);
      if (mark !== col.mark) {
        col.mark?.classList.remove("mark");
        mark?.classList.add("mark");
        col.mark = mark;
      }
      const now = live ? col.glyphs.get(shown[i]) : undefined;
      if (now === col.on) return;
      col.on?.classList.remove("on");
      now?.classList.add("on");
      col.on = now;
    });
};

const holdLegend = (change: () => void) => {
  // Before first paint there's nowhere to slide from.
  if (!sheet.classList.contains("ready")) return change();
  const from = legend.getBoundingClientRect().top;
  change();
  const by = from - legend.getBoundingClientRect().top;
  if (Math.abs(by) < 1 || calm()) return;
  legend.animate([{ translate: `0 ${by}px` }, { translate: "0 0" }], {
    duration: 360,
    easing: EASE,
    composite: "add",
  });
};

const later = () => {
  clearTimeout(timer);
  if (!paused && !over) timer = window.setTimeout(cycle, REST);
};

const onFrame = (f: Frame) => {
  last = f;
  if (f.pools !== drawnPools) drawColumns(f.pools);
  light(f);
  if (f.settled && running) {
    decoding(false);
    later();
  }
};

const d = decoder(line, engine(), { onFrame, graze: true });

const run = (raw: string) => {
  const text = inCase(raw, lettercase);
  clearTimeout(timer);
  if (held) hold();
  if (rowHeld) letGo();
  holdLegend(() => place(text));
  decoding(true);
  d.decode(text);
  measure();
};

function cycle() {
  run(own ?? LINES[(next = (next + 1) % LINES.length)]);
}

const wait = () => {
  over = true;
  clearTimeout(timer);
};
const carryOn = () => {
  over = false;
  if (!running) later();
};
sheet.addEventListener("pointerenter", (e) => {
  if (e.pointerType === "mouse") wait();
});
let held = 0;
function hold() {
  clearTimeout(held);
  wait();
  held = window.setTimeout(() => {
    held = 0;
    carryOn();
  }, TAP_HOLD);
}
// Only keyboard focus holds it, since clicking or tapping the line focuses it too.
const keyed = () => !!sheet.querySelector(":focus-visible");
sheet.addEventListener("pointerleave", (e) => {
  if (e.pointerType === "mouse" && !keyed()) carryOn();
});
sheet.addEventListener("focusin", () => {
  if (keyed()) wait();
});
sheet.addEventListener("focusout", (e) => {
  if (!sheet.contains(e.relatedTarget as Node) && !sheet.matches(":hover"))
    carryOn();
});

const pauseButton = $<HTMLButtonElement>("pause");
const showPaused = () => {
  pauseButton.toggleAttribute("data-paused", paused);
  say(pauseButton.querySelector(".pause-text")!, paused ? "Play" : "Pause");
};
pauseButton.addEventListener("click", () => {
  paused = !paused;
  showPaused();
  if (paused) clearTimeout(timer);
  else if (!running) cycle();
});
showPaused();

// Blur after a click so your next key press doesn't replay the line.
stage.addEventListener("click", (e) => {
  if (performance.now() - tapped < 600) return;
  if (e.detail > 0) stage.blur();
  cycle();
});

// Taps come from pointer events: a graze rebuilds the letters under your
// finger, and phones drop the click when its target is replaced.
let tap: { id: number; x: number; y: number } | null = null;
let tapped = -Infinity;
stage.addEventListener("pointerdown", (e) => {
  if (e.pointerType === "mouse") return;
  line.setPointerCapture(e.pointerId);
  tap = { id: e.pointerId, x: e.clientX, y: e.clientY };
});
stage.addEventListener("pointerup", (e) => {
  if (!tap || e.pointerId !== tap.id) return;
  const still = Math.hypot(e.clientX - tap.x, e.clientY - tap.y) < 10;
  tap = null;
  if (!still) return;
  tapped = performance.now();
  stage.blur();
  hold();
  cycle();
});
stage.addEventListener("pointercancel", () => (tap = null));

const explain = (col?: HTMLElement) => {
  if (!col) {
    say(
      key,
      sheet.classList.contains("indexed")
        ? `Each letter: its width in px, how many look-alikes it has, then the letters within ${percent()} of its width it can scramble through, or its nearest three.`
        : `Under each letter: its width in px, and the letters within ${percent()} of it that it can scramble through, or its nearest three.`,
    );
    return;
  }
  const { letter, n, hidden } = col.dataset;
  const w = col.dataset.width;
  const rest = Number(hidden) ? `; ${hidden} aren’t shown` : "";
  say(
    key,
    `${letter} is ${w}px wide. It scrambles through ${n} ${n === "1" ? "letter" : "letters"} of about that width${rest}.`,
  );
};

let stirring = 0;
const inspect = (i: number | null) => {
  clearInterval(stirring);
  stage.classList.toggle("inspecting", i !== null);
  for (const lit of line.querySelectorAll(".lit")) lit.classList.remove("lit");
  if (i === null) return;
  const stir = () => {
    d.stir(i);
    line.querySelector(`[data-i="${i}"]`)?.classList.add("lit");
  };
  stir();
  // Re-stir faster than it cools, so it never settles under your pointer.
  stirring = window.setInterval(stir, 100);
};

const measureTo = meter(cols);

// Focus sticks until another column takes it, so crossing the gap
// between two doesn't drop it.
let focused: HTMLElement | null = null;
const focus = (col: HTMLElement | null) => {
  if (col === focused) return;
  focused?.classList.remove("focus");
  col?.classList.add("focus");
  cols.classList.toggle("focusing", !!col);
  focused = col;
  explain(col ?? undefined);
  inspect(col ? Number(col.dataset.i) : null);
  measureTo(col);
};
cols.addEventListener("pointerover", (e) => {
  const col = (e.target as Element).closest<HTMLElement>(".col");
  if (col) focus(col);
});
cols.addEventListener("pointerleave", () => focus(null));

let hot: HTMLElement | null = null;
const heat = (entry: HTMLElement | null) => {
  if (entry === hot) return;
  hot?.classList.remove("hot");
  entry?.classList.add("hot");
  hot = entry;
  explain(entry ?? undefined);
  inspect(entry ? Number(entry.dataset.i) : null);
};
index.addEventListener("pointerover", (e) =>
  heat((e.target as Element).closest<HTMLElement>(".entry")),
);
index.addEventListener("pointerleave", (e) => {
  if (e.pointerType === "mouse") heat(null);
});
let rowHeld = 0;
const letGo = () => {
  clearTimeout(rowHeld);
  rowHeld = 0;
  heat(null);
};
index.addEventListener("pointerup", (e) => {
  if (e.pointerType === "mouse") return;
  const entry = (e.target as Element).closest<HTMLElement>(".entry");
  if (!entry) return;
  heat(entry);
  hold();
  clearTimeout(rowHeld);
  rowHeld = window.setTimeout(letGo, TAP_HOLD);
});

const { toggle, list, gliding } = menus(dock, phone);
const inputs = ["hold", "stagger", "match", "heat", "spill"] as const;
const feel = $<HTMLFieldSetElement>("feel");
const reset = $<HTMLButtonElement>("reset");
const percent = () => `${Math.round(settings.match * 100)}%`;
const frames = (n: number) => {
  const ms = (n * 1000) / 60;
  return ms < 1000
    ? `${Math.round(ms)}\u00A0ms`
    : `${(ms / 1000).toFixed(2)}\u00A0s`;
};

const face = $<HTMLButtonElement>("face");
// Sample fonts load when you head for the chip, not with the page.
const ready = () => $("face-menu").classList.add("ready");
for (const type of ["pointerenter", "focus"])
  face.addEventListener(type, ready, { once: true });
list(face, async (id) => {
  const f = FACES.find((f) => f.id === id);
  if (!f) return;
  fadeUp(face.querySelector(".face-k")!);
  await document.fonts.load(`${f.weight} 100px ${f.family}`).catch(() => {});
  const root = document.documentElement.style;
  root.setProperty("--face", f.family);
  root.setProperty("--face-weight", String(f.weight));
  root.setProperty("--face-tracking", f.tracking);
  decoding(false);
  relayout();
  run(d.text);
});

const alphabet = list($("alphabet"), (id) => {
  const a = ALPHABETS.find((a) => a.id === id);
  if (a) apply({ ...settings, alphabet: a.chars });
  run(d.text);
});

const choose = (group: HTMLElement) => (id: string) => {
  const radio = group.querySelector<HTMLInputElement>(`input[value="${id}"]`);
  if (!radio) return;
  radio.checked = true;
  radio.dispatchEvent(new Event("change", { bubbles: true }));
};
const feelMenu = list($("feel-chip"), choose(feel));
const caseMenu = list($("case-chip"), choose($("case")));

const show = () => {
  for (const k of inputs) {
    const el = $<HTMLInputElement>(k);
    const v = k === "match" ? Math.round(settings[k] * 100) : settings[k];
    el.value = String(v);
    track(el, v);
    const said = k === "match" ? `${v}%` : frames(v);
    $(`${k}-out`).textContent = said;
    el.setAttribute("aria-valuetext", said);
  }
  $("summary").textContent =
    `${settings.hold} · ${settings.stagger} · ${percent()}`;
  alphabet.set(
    ALPHABETS.find((a) => a.chars === settings.alphabet)?.id ?? "caps",
  );
  for (const r of feel.querySelectorAll("input"))
    r.checked = r.value === settings.feel;
  feelMenu.set(settings.feel);
  reset.hidden = (Object.keys(DEFAULTS) as (keyof Settings)[]).every(
    (k) => settings[k] === DEFAULTS[k],
  );
};

const apply = (next: Settings) => {
  settings = next;
  d.set(engine());
  show();
  explain();
};

for (const k of inputs) {
  const el = $<HTMLInputElement>(k);
  el.addEventListener("input", () => {
    const n = el.valueAsNumber;
    if (!Number.isFinite(n)) return;
    const v = Math.min(Number(el.max), Math.max(Number(el.min), n));
    apply({ ...settings, [k]: k === "match" ? v / 100 : v });
  });
  // Let go of a slider and it shows you the change.
  el.addEventListener("change", () =>
    k === "heat" || k === "spill" ? sweep() : run(d.text),
  );
}

let sweeping = 0;
const sweep = () => {
  cancelAnimationFrame(sweeping);
  if (calm()) return;
  const count = [...d.text].length;
  const t0 = performance.now();
  let at = -1;
  const step = (now: number) => {
    const p = Math.min(1, (now - t0) / 900);
    const i = Math.min(count - 1, Math.floor(p * count));
    for (; at < i;) d.stir(++at, true);
    if (p < 1) sweeping = requestAnimationFrame(step);
  };
  sweeping = requestAnimationFrame(step);
};

const tune = $<HTMLButtonElement>("tune");
tune.addEventListener("click", () => toggle(tune));

// --reach: how far your line's field opens, up to the feel divider.
const write = $("write");
const reach = () => {
  const stop = $("sep-feel");
  write.style.setProperty(
    "--reach",
    `${stop.offsetLeft - write.offsetLeft - 6}px`,
  );
};
new ResizeObserver(reach).observe(dock);
// --bar: the bar's width, so the legend can match it.
const keepTo = () =>
  document.documentElement.style.setProperty("--bar", `${dock.offsetWidth}px`);
keepTo();
new ResizeObserver(keepTo).observe(dock);

feel.addEventListener("change", (e) =>
  feelMenu.set((e.target as HTMLInputElement).value),
);
$("case").addEventListener("change", (e) =>
  caseMenu.set((e.target as HTMLInputElement).value),
);

feel.addEventListener("change", (e) => {
  const f = FEELS.find((f) => f.id === (e.target as HTMLInputElement).value);
  if (f) apply({ ...settings, feel: f.id, hold: f.hold, stagger: f.stagger });
  run(d.text);
});

$("case").addEventListener("change", (e) => {
  lettercase = (e.target as HTMLInputElement).value as Case;
  d.set(engine());
  fit();
  run(d.text);
});

// Reset hides itself, so move focus on first.
reset.addEventListener("click", () => {
  if (document.activeElement === reset) $("copy-settings").focus();
  apply({ ...DEFAULTS });
  run(d.text);
});

const ownInput = $<HTMLInputElement>("own");
ownInput.addEventListener("keydown", (e) => {
  if (e.key === "Escape") ownInput.blur();
});
ownInput.addEventListener("input", () => {
  if (own === null || ownInput.value.trim()) return;
  own = null;
  fit();
  run(LINES[next]);
});
$<HTMLFormElement>("write").addEventListener("submit", (e) => {
  e.preventDefault();
  own = ownInput.value.trim().replace(/\s+/g, " ") || null;
  fit();
  run(own ?? LINES[next]);
});

$<HTMLButtonElement>("copy-settings").addEventListener("click", (e) =>
  copy(e.currentTarget as HTMLButtonElement, asCode(engine()), status),
);
$<HTMLButtonElement>("copy-file").addEventListener("click", (e) =>
  copy(e.currentTarget as HTMLButtonElement, source, status),
);

const relayout = () => {
  fit();
  place(d.text);
  d.land(d.text);
  measure();
  if (!running) later();
};

// Only a new width refits the line, so a phone toolbar showing or hiding
// doesn't interrupt your decode.
let resized = 0;
let wide = 0;
const resizing = new ResizeObserver(() => {
  if (gliding()) return;
  cancelAnimationFrame(resized);
  resized = requestAnimationFrame(() => {
    if (room() !== wide) {
      wide = room();
      return relayout();
    }
    place(d.text);
    measure();
  });
});
resizing.observe(sheet);
resizing.observe(dock);

const sizeChip = $<HTMLButtonElement>("size-chip");
sizeChip.addEventListener("click", () => toggle(sizeChip));
const size = $<HTMLInputElement>("size");
size.addEventListener("input", () => {
  const n = size.valueAsNumber;
  chosen = n >= fitted ? null : n;
  decoding(false);
  relayout();
});
$("fit").addEventListener("click", () => {
  chosen = null;
  decoding(false);
  relayout();
  size.focus();
});

const words = (
  [
    [".name a", "lower"],
    [".links a", "title"],
  ] as const
).flatMap(([at, c]) =>
  [...document.querySelectorAll<HTMLElement>(at)].map((el) => {
    const word = decoder(el, {
      ...DEFAULTS,
      hold: 10,
      stagger: 3,
      alphabet: alphabetIn(DEFAULTS.alphabet, c),
    });
    el.addEventListener("pointerenter", () => word.decode());
    return word;
  }),
);

document.fonts.load(`800 ${MAX}px "Geist Variable"`).finally(() => {
  show();
  fit();
  run(LINES[0]);
  for (const word of words) word.decode();
  sheet.classList.add("ready");
});
