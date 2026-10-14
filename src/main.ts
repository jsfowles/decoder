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

const $ = <T extends HTMLElement>(id: string) =>
  document.getElementById(id) as T;

// Text that changes in place fades up from faint rather than jumping.
const fadeUp = (el: Element) =>
  el.animate([{ opacity: 0.25 }, { opacity: 1 }], {
    duration: 240,
    easing: "cubic-bezier(0.23, 1, 0.32, 1)",
  });
// A change while one is fading in carries on with that fade, so a sweep
// across the columns or a dragged slider doesn't strobe.
const say = (el: Element, text: string) => {
  if (el.textContent === text) return;
  el.textContent = text;
  if (!el.getAnimations().length) fadeUp(el);
};

// It opens on what it does, then drifts into messages coming through.
const LINES = [
  "NOTHING MOVES",
  "SIGNAL FOUND",
  "ALMOST LEGIBLE",
  "COPY THAT",
  "STAND BY",
  "OVER AND OUT",
];
// Rest between one line landing and the next starting.
const REST = 2200;
// The line's size: as big as fits on one line, between these.
const MAX = 168;
const MIN = 32;
// Under this, columns under the letters get too small to read: the
// look-alikes are listed in an index under the line instead.
const SMALL = 80;
// Rows of look-alikes a column shows before it counts the rest: as many as
// the window has room for under the line, so a tall window fills with
// them, but fewer under a smaller line, so the block keeps its proportion.
const rows = () => {
  const size = parseFloat(getComputedStyle(line).fontSize);
  const top = sheet.getBoundingClientRect().top + scrollY;
  // Everything else on the sheet: its padding, the line, the bracket and
  // count, the gaps around the columns, and the legend.
  const room = innerHeight - top - 56 - size * 0.9 - 60 - 46 - 76;
  const fit = Math.floor(room / (cell() * 1.18));
  return Math.max(3, Math.min(12, Math.round(size / 9), fit));
};

const sheet = $("sheet");
const stage = $<HTMLButtonElement>("stage");
const line = $("line");
const probe = $("probe");
const cols = $("cols");
const key = $("key");
const status = $("status");

let settings: Settings = { ...DEFAULTS };
let lettercase: Case = "upper";
// What the engine gets: the settings, with the alphabet in the line's case.
const engine = (): Settings => ({
  ...settings,
  alphabet: alphabetIn(settings.alphabet, lettercase),
});
let own: string | null = null;
let next = 0;
let timer = 0;
let running = false;
// A line decoding, as opposed to a graze or a stir: only then do the
// brackets pull in and redraw as their letters land.
const decoding = (on: boolean) => {
  running = on;
  cols.classList.toggle("decoding", on);
};
// The pointer is on the line: the next line waits until it leaves.
let over = false;

// The columns under the letters, drawn for one text and one set of pools.
type Col = {
  el: HTMLElement;
  glyphs: Map<string, HTMLElement>;
  // The look-alike the scramble shows now.
  on?: HTMLElement;
  // The letter itself, picked out once it lands.
  mark?: HTMLElement;
  live?: boolean;
};
let columns: (Col | null)[] = [];
let geometry: { x: number; w: number }[] = [];
let drawnPools: Frame["pools"] | null = null;
let drawnText = "";
let enteredAt = 0;
let last: Frame | null = null;

// Fitted, one size serves every line it shows, set by the widest, so the
// sheet holds still from one line to the next. Measured on a probe at full
// size. A size you pick instead wraps whatever doesn't fit.
let chosen: number | null = null;
let indexed = false;
let fitted = MAX;

const wideAt = (t: string) => {
  probe.style.fontSize = `${MAX}px`;
  probe.textContent = t;
  return probe.getBoundingClientRect().width;
};

// On a phone the line takes two rows, so it can be set twice the size:
// what has to fit is each line's longer half, split where it's most even.
const phone = matchMedia("(max-width: 759px)");
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

const fit = () => {
  const measure = phone.matches ? halves : wideAt;
  const wide = Math.max(
    ...[...LINES, own ?? ""].map((t) => measure(inCase(t, lettercase))),
  );
  const size = wide ? Math.floor((MAX * sheet.clientWidth * 0.98) / wide) : MAX;
  fitted = Math.max(MIN, Math.min(MAX, size));
  // A size you picked never outgrows the window: at the fit, it's the fit.
  if (chosen !== null && chosen >= fitted) chosen = null;
};

// Sets the size for `text`, and whether it has to wrap at that size.
const place = (text: string) => {
  const px = chosen ?? fitted;
  document.documentElement.style.setProperty("--line", `${px}px`);
  document.documentElement.style.setProperty("--rows", String(rows()));
  if (sheet.classList.toggle("indexed", px < SMALL) !== indexed) {
    indexed = !indexed;
    if (!focused && !hot) explain();
  }
  sheet.classList.toggle(
    "wrapped",
    (wideAt(text) * px) / MAX > sheet.clientWidth * 0.98,
  );
  const size = $<HTMLInputElement>("size");
  // The slider runs from small up to the fit, so the line never wraps.
  size.max = String(fitted);
  size.value = String(px);
  const [lo, hi] = [Number(size.min), Number(size.max)];
  size.style.setProperty("--p", `${((px - lo) / (hi - lo)) * 100}%`);
  $("size-val").textContent = String(px);
  $("size-out").textContent = `${px}\u00A0px`;
  size.setAttribute("aria-valuetext", `${px} px`);
  $("fit").hidden = chosen === null;
  $("fitted").hidden = chosen !== null;
};

// A look-alike's size, as --pool-size sets it.
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

// Where each letter sits: its pinned box while running, else its place in
// the plain text.
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
  // The frame already drawn for this text: redraw under it now.
  if (last?.text === d.text) {
    drawColumns(last.pools);
    light(last);
  }
};

// The columns persist from line to line: each slides and resizes to the
// letter it now hangs under, its look-alikes cross-fade, and a longer line
// adds columns at the end while a shorter one lets them go.
let nodes: HTMLElement[] = [];
const stateOf = new WeakMap<HTMLElement, Col>();

// Under a narrow column the count drops its word, so it stays inside it.
const fill = (
  col: HTMLElement,
  pool: string[],
  across: number,
  short: boolean,
  tall: number,
) => {
  const room = across * tall;
  const set = document.createElement("span");
  set.className = "set";
  set.style.setProperty("--across", String(across));
  const glyphs = new Map<string, HTMLElement>();
  for (const g of pool.slice(0, room)) {
    const span = document.createElement("span");
    span.textContent = g;
    glyphs.set(g, span);
    set.append(span);
  }
  const more = document.createElement("span");
  more.className = "more";
  const rest = pool.length - room;
  more.textContent = rest > 0 ? `+${rest}${short ? "" : " more"}` : "";
  col.dataset.n = String(pool.length);
  col.dataset.hidden = String(Math.max(0, pool.length - room));
  col.querySelector(".set")?.remove();
  col.querySelector(".more")?.remove();
  col.append(set, more);
  // New glyphs: nothing is lit or marked in them yet.
  const state = stateOf.get(col);
  if (state) Object.assign(state, { glyphs, on: undefined, mark: undefined });
  else stateOf.set(col, { el: col, glyphs });
  return set;
};

const drawColumns = (pools: Frame["pools"]) => {
  const now = performance.now();
  const next = d.text !== drawnText;
  if (next) enteredAt = now;
  // Measuring redraws a new line's columns straight after they're first
  // drawn; that redraw still moves. Any other redraw just snaps.
  const moving = now - enteredAt < 100;
  cols.classList.toggle("instant", !moving);
  drawnPools = pools;
  drawnText = d.text;
  columns = [];
  // Read once, before the columns are written, not once a column.
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
    col.style.transform = `translateX(${at.x - at.w / 2}px)`;
    col.style.width = `${at.w}px`;
    col.dataset.width = String(Math.round(at.w));
    col.dataset.x = String(at.x);
    col.dataset.w = String(at.w);
    col.querySelector(".w")!.textContent = col.dataset.width;
    col.dataset.letter = [...d.text][i];
    col.dataset.i = String(i);
    // As many to a row as fit, clear of the next column.
    const across = Math.max(1, Math.floor((at.w - 6) / (size * 1.25)));
    const short = at.w < 56;
    const key = `${pool.join("")}|${across}|${short}`;
    if (col.dataset.key !== key) {
      col.dataset.key = key;
      const set = fill(col, pool, across, short, tall);
      if (!fresh && moving) set.classList.add("swap");
    }
    columns.push(stateOf.get(col)!);
    k++;
  });
  for (const gone of nodes.slice(k)) {
    gone.classList.add("out");
    // Once it has faded: --duration-base.
    setTimeout(() => gone.remove(), 240);
  }
  nodes = nodes.slice(0, k);
  if (!moving) requestAnimationFrame(() => cols.classList.remove("instant"));
  drawIndex(pools);
};

// What's under the line glides to its new place rather than jumping when
// what's above it changes height. Movement, so not with reduced motion.
const calm = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
const EASE = "cubic-bezier(0.23, 1, 0.32, 1)";

// A block eases from its old height to its new one, clipped while it does
// so nothing spills over what's under it. Its height is read mid-glide, so
// a change during one carries on from where it is.
const glides = new WeakMap<HTMLElement, Animation>();
const easeHeight = (el: HTMLElement, change: () => void) => {
  const from = el.getBoundingClientRect().height;
  glides.get(el)?.cancel();
  change();
  const to = el.getBoundingClientRect().height;
  el.style.overflow = "";
  if (!from || !to || Math.abs(to - from) < 1 || calm()) return;
  el.style.overflow = "clip";
  // --duration-enter.
  const a = el.animate([{ height: `${from}px` }, { height: `${to}px` }], {
    duration: 360,
    easing: EASE,
  });
  glides.set(el, a);
  a.finished.then(
    () => (el.style.overflow = ""),
    () => {},
  );
};

// The legend, when the line above it changes size, slides from where it
// was. Added on, so a second change mid-slide carries on from there.
const legend = sheet.querySelector<HTMLElement>(".legend")!;
const holdLegend = (change: () => void) => {
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

// Under a small line, the same look-alikes as an index: each letter, its
// width and how many it has, then the letters themselves, at a size to
// read. It lights as the columns do. A line with more letters or fewer
// eases the index to its new height.
const index = $("index");
let entries: (Col | null)[] = [];
// Redrawn only when what it lists changes, and comes in fading only with
// a new line: a graze or a slider that leaves it the same leaves it be.
let listed = "";
let listedText = "";
const drawIndex = (pools: Frame["pools"]) => {
  const now = `${d.text}|${pools.map((p, i) => `${p?.join("") ?? ""}:${Math.round(geometry[i]?.w ?? 0)}`).join("|")}`;
  if (now === listed) return;
  listed = now;
  const fresh = d.text !== listedText;
  listedText = d.text;
  easeHeight(index, () => fillIndex(pools, fresh));
};
const fillIndex = (pools: Frame["pools"], fresh: boolean) => {
  const text = [...d.text];
  index.replaceChildren();
  // Each letter once: a second N says nothing the first didn't, so the
  // first carries how many there are.
  const seen = new Set<string>();
  const times = new Map<string, number>();
  pools.forEach((pool, i) => {
    if (pool) times.set(text[i], (times.get(text[i]) ?? 0) + 1);
  });
  entries = pools.map((pool, i) => {
    if (!pool || seen.has(text[i])) return null;
    seen.add(text[i]);
    const el = document.createElement("div");
    el.className = "entry";
    if (!fresh) el.style.animation = "none";
    const w = String(Math.round(geometry[i]?.w ?? 0));
    Object.assign(el.dataset, {
      i: String(i),
      letter: text[i],
      width: w,
      n: String(pool.length),
      hidden: "0",
    });
    const ch = document.createElement("span");
    ch.className = "ch";
    ch.textContent = text[i];
    const n = times.get(text[i]) ?? 1;
    if (n > 1) {
      const x = document.createElement("span");
      x.className = "times";
      x.textContent = `×${n}`;
      ch.append(x);
    }
    const about = document.createElement("span");
    about.className = "about";
    about.textContent = `${w}\u00A0px · ${pool.length}`;
    const set = document.createElement("span");
    set.className = "pool";
    const glyphs = new Map<string, HTMLElement>();
    for (const g of pool) {
      const span = document.createElement("span");
      span.textContent = g;
      glyphs.set(g, span);
      set.append(span);
    }
    el.append(ch, about, set);
    index.append(el);
    return { el, glyphs };
  });
};

// Blacks out the look-alike each scrambling letter shows now.

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

const onFrame = (f: Frame) => {
  last = f;
  if (f.pools !== drawnPools) drawColumns(f.pools);
  light(f);
  if (f.settled && running) {
    decoding(false);
    if (!over) timer = window.setTimeout(cycle, REST);
  }
};

const d = decoder(line, engine(), { onFrame, graze: true });

const run = (raw: string) => {
  const text = inCase(raw, lettercase);
  clearTimeout(timer);
  holdLegend(() => place(text));
  decoding(true);
  d.decode(text);
  measure();
};

function cycle() {
  run(own ?? LINES[(next = (next + 1) % LINES.length)]);
}

// Over the sheet, the line, its columns or the key, or focused in it, the
// next line waits.
const wait = () => {
  over = true;
  clearTimeout(timer);
};
const carryOn = () => {
  over = false;
  if (!running) {
    clearTimeout(timer);
    timer = window.setTimeout(cycle, REST);
  }
};
sheet.addEventListener("pointerenter", wait);
// Only keyboard focus holds it: a click or tap on the line focuses it too.
const keyed = () => !!sheet.querySelector(":focus-visible");
sheet.addEventListener("pointerleave", () => {
  if (!keyed()) carryOn();
});
sheet.addEventListener("focusin", () => {
  if (keyed()) wait();
});
sheet.addEventListener("focusout", (e) => {
  if (!sheet.contains(e.relatedTarget as Node) && !sheet.matches(":hover"))
    carryOn();
});

// A click goes on to the next line now; your own line just plays again.
// Clicked or tapped, it doesn't keep focus, so a key pressed after never
// rings it; from the keyboard it does.
stage.addEventListener("click", (e) => {
  if (e.detail > 0) stage.blur();
  cycle();
});

// Settings: the bar above the sheet, and its tuning panel.
const inputs = ["hold", "stagger", "match", "heat", "spill"] as const;
const feel = $<HTMLFieldSetElement>("feel");
const reset = $<HTMLButtonElement>("reset");
const percent = () => `${Math.round(settings.match * 100)}%`;
// Frames, said as time: what a person feels, not what the engine counts.
const frames = (n: number) => {
  const ms = (n * 1000) / 60;
  return ms < 1000
    ? `${Math.round(ms)}\u00A0ms`
    : `${(ms / 1000).toFixed(2)}\u00A0s`;
};

// Chips that open something: Tune's panel, and the typeface and alphabet
// lists. One is open at a time; Escape, or a click anywhere else, closes it.
const dock = $("dock");
const chips = [
  ...dock.querySelectorAll<HTMLButtonElement>("button[aria-expanded]"),
];
const isOpen = (chip: HTMLElement) =>
  chip.getAttribute("aria-expanded") === "true";
// What a chip opens is the element after it. On a narrow screen the
// Settings panel holds the other chips, so opening one of those leaves
// Settings open, and closing Settings closes what's open inside it.
// Settings opens the whole bar on a phone, your line included.
const opens = (chip: HTMLElement) =>
  chip.id === "settings" ? dock : (chip.nextElementSibling as HTMLElement);
const within = (chip: HTMLElement, node: Node) =>
  chip.contains(node) || opens(chip).contains(node);
const close = (chip: HTMLButtonElement) => {
  if (chip.id === "settings" && isOpen(chip) && smooth()) return fold(chip);
  chip.setAttribute("aria-expanded", "false");
  for (const c of chips) if (c !== chip && opens(chip).contains(c)) close(c);
};

// On a phone, Settings opens the bar downward as part of the page, so the
// bar grows and everything under it glides down with it; closing, the rows
// fade as it shrinks, and leave the layout only once it has.
// What Settings opens on a phone, below the bar.
const ROWS =
  ".lead, .row-label, .write, .sizer, .case, .drop:has(#alphabet), .panel";
const smooth = () => phone.matches && !calm();
let growing: Animation | null = null;
const glide = (from: number, to: number, ms: number) => {
  growing?.cancel();
  dock.style.overflow = "clip";
  growing = dock.animate([{ height: `${from}px` }, { height: `${to}px` }], {
    duration: ms,
    easing: "cubic-bezier(0.23, 1, 0.32, 1)",
  });
  return growing;
};
// Turned round mid-way, each picks up from the height and fade it's at.
const unfold = (chip: HTMLButtonElement) => {
  const from = dock.getBoundingClientRect().height;
  growing?.cancel();
  dock.classList.remove("folding");
  for (const row of dock.querySelectorAll<HTMLElement>(ROWS)) {
    const fading = row.getAnimations();
    if (!fading.length) continue;
    const o = getComputedStyle(row).opacity;
    for (const a of fading) a.cancel();
    row.animate([{ opacity: o }, { opacity: 1 }], {
      duration: 150,
      easing: EASE,
    });
  }
  chip.setAttribute("aria-expanded", "true");
  const to = dock.getBoundingClientRect().height;
  // --duration-enter, out on --ease-out.
  glide(from, to, 360).onfinish = () => (dock.style.overflow = "");
};
const fold = (chip: HTMLButtonElement) => {
  const from = dock.getBoundingClientRect().height;
  growing?.cancel();
  // The closed height, read without painting it.
  chip.setAttribute("aria-expanded", "false");
  const to = dock.getBoundingClientRect().height;
  chip.setAttribute("aria-expanded", "true");
  dock.classList.add("folding");
  // The rows fade out ahead of the edge coming up over them.
  const fades = [...dock.querySelectorAll<HTMLElement>(ROWS)].map((row) =>
    row.animate([{ opacity: getComputedStyle(row).opacity }, { opacity: 0 }], {
      duration: 150,
      easing: "cubic-bezier(0.23, 1, 0.32, 1)",
      fill: "forwards",
    }),
  );
  // --duration-base: closing is quicker than opening.
  glide(from, to, 240).onfinish = () => {
    for (const f of fades) f.cancel();
    dock.classList.remove("folding");
    dock.style.overflow = "";
    chip.setAttribute("aria-expanded", "false");
    for (const c of chips) if (c !== chip && opens(chip).contains(c)) close(c);
  };
};
const toggle = (chip: HTMLButtonElement, open = !isOpen(chip)) => {
  for (const c of chips) if (c !== chip && !opens(c).contains(chip)) close(c);
  if (open) chip.setAttribute("aria-expanded", "true");
  else close(chip);
};
document.addEventListener("pointerdown", (e) => {
  for (const c of chips.filter(isOpen))
    if (!within(c, e.target as Node)) close(c);
});
// Tabbing on past one closes it, so it never sits over what you tab to.
// Not Settings: on a phone everything it opens is part of the bar.
for (const c of chips.filter((c) => c.id !== "settings"))
  for (const el of [c, opens(c)])
    el.addEventListener("focusout", (e) => {
      const to = e.relatedTarget as Node | null;
      if (to && isOpen(c) && !within(c, to)) close(c);
    });
dock.addEventListener("keydown", (e) => {
  // The innermost open one closes first.
  const chip = chips.filter(isOpen).at(-1);
  if (e.key !== "Escape" || !chip) return;
  close(chip);
  chip.focus();
});
const settingsChip = $<HTMLButtonElement>("settings");
settingsChip.addEventListener("click", () => {
  if (isOpen(settingsChip) && !dock.classList.contains("folding"))
    return close(settingsChip);
  if (smooth()) unfold(settingsChip);
  else toggle(settingsChip, true);
});

// A chip with a list: its options behave like a select's, by pointer or
// by keys, and the chip shows the one chosen.
const list = (chip: HTMLButtonElement, onPick: (id: string) => void) => {
  const menu = chip.nextElementSibling as HTMLElement;
  const options = [...menu.querySelectorAll<HTMLElement>("[role=option]")];
  let value =
    options.find((o) => o.getAttribute("aria-selected") === "true")?.dataset
      .v ?? "";
  const chosen = () => options.find((o) => o.dataset.v === value)!;
  const set = (id: string) => {
    value = id;
    for (const o of options)
      o.setAttribute("aria-selected", String(o.dataset.v === id));
    for (const v of chip.querySelectorAll<HTMLElement>(".val > [data-v]"))
      v.toggleAttribute("data-on", v.dataset.v === id);
  };
  const pick = (o: HTMLElement) => {
    toggle(chip, false);
    chip.focus();
    if (o.dataset.v === value) return;
    set(o.dataset.v!);
    onPick(value);
  };
  // Opened from the keyboard, focus lands on the chosen option, ringed;
  // opened by pointer, on the list itself, so no ring shows unasked.
  chip.addEventListener("click", (e) => {
    toggle(chip);
    if (isOpen(chip))
      (e.detail === 0 ? chosen() : menu).focus({ preventScroll: true });
  });
  chip.addEventListener("keydown", (e) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    toggle(chip, true);
    chosen().focus({ preventScroll: true });
  });
  menu.addEventListener("click", (e) => {
    const o = (e.target as Element).closest<HTMLElement>("[role=option]");
    if (o) pick(o);
  });
  menu.addEventListener("keydown", (e) => {
    // From the list itself, the arrows start at the chosen one.
    const at = options.indexOf(document.activeElement as HTMLElement);
    const i = at < 0 ? options.indexOf(chosen()) : at;
    const go = (n: number) => {
      e.preventDefault();
      options[(n + options.length) % options.length].focus();
    };
    if (e.key === "ArrowDown") go(i + 1);
    else if (e.key === "ArrowUp") go(i - 1);
    else if (e.key === "Home") go(0);
    else if (e.key === "End") go(options.length - 1);
    else if ((e.key === "Enter" || e.key === " ") && i >= 0) {
      e.preventDefault();
      pick(options[i]);
    } else if (e.key === "Tab") toggle(chip, false);
  });
  return { set };
};

// A new face: wait for it, then set the line in it and decode again.
const face = $<HTMLButtonElement>("face");
// The list's samples fetch their faces once someone heads for the chip,
// a beat before it opens, not with the page.
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

const show = () => {
  for (const k of inputs) {
    const el = $<HTMLInputElement>(k);
    const v = k === "match" ? Math.round(settings[k] * 100) : settings[k];
    el.value = String(v);
    const [lo, hi] = [Number(el.min), Number(el.max)];
    el.style.setProperty("--p", `${((v - lo) / (hi - lo)) * 100}%`);
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

// The key under the columns: what a column is, or, over one, what it holds.
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

// The column under the pointer stays in focus until another takes it, so
// crossing the gap between two doesn't drop it.
let focused: HTMLElement | null = null;
// A focused column's letter scrambles through just that column, lit in the
// line while the rest of the line steps back.
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
  // Inside a stir's heat, so it never cools while the pointer stays.
  stirring = window.setInterval(stir, 100);
};

// One measuring bracket travels with the pointer from column to column:
// it draws out from the middle of the first, then glides and resizes to
// each next one while its figure counts from the last width to this.
const meter = document.createElement("div");
meter.className = "meter";
meter.setAttribute("aria-hidden", "true");
for (const part of ["rule", "tick", "tick", "fig"]) {
  const el = document.createElement("span");
  el.className = part;
  meter.append(el);
}
cols.append(meter);
const [rule, left, right, fig] = [...meter.children] as HTMLElement[];
let reading = 0;
let counting = 0;

const span = (from: number, to: number) => {
  rule.style.transform = `translateX(${from}px) scaleX(${Math.max(0, to - from)})`;
  left.style.transform = `translateX(${from}px)`;
  right.style.transform = `translateX(${to - 1}px)`;
  fig.style.transform = `translateX(${(from + to) / 2}px) translateX(-50%)`;
};

const countTo = (to: number) => {
  cancelAnimationFrame(counting);
  const from = reading;
  if (calm()) {
    fig.textContent = String((reading = to));
    return;
  }
  const start = performance.now();
  const step = (now: number) => {
    // In step with the glide: --duration-follow.
    const t = Math.min(1, (now - start) / 280);
    // Ease out quint, like the bracket.
    reading = Math.round(from + (to - from) * (1 - (1 - t) ** 5));
    fig.textContent = String(reading);
    if (t < 1) counting = requestAnimationFrame(step);
  };
  counting = requestAnimationFrame(step);
};

const measureTo = (col: HTMLElement | null) => {
  const on = meter.classList.contains("on");
  if (!col) {
    meter.classList.remove("on");
    return;
  }
  const x = Number(col.dataset.x);
  const w = Number(col.dataset.w);
  if (!on) {
    // Collapsed at the middle first, so it draws out from there.
    meter.classList.add("instant");
    span(x, x);
    reading = 0;
    void meter.offsetWidth;
    meter.classList.remove("instant");
  }
  meter.classList.add("on");
  span(x - w / 2 + 1, x + w / 2 - 1);
  countTo(Math.round(w));
};

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

// Pointing at an index entry lights its letter, as a column does.
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
index.addEventListener("pointerleave", () => heat(null));

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
  // Let go and it shows what it does: the timing and the look-alikes play
  // the line again; heat and spill run the pointer across it.
  el.addEventListener("change", () =>
    k === "heat" || k === "spill" ? sweep() : run(d.text),
  );
}

// The pointer, run across the line as you would, so a change to heat or
// spill shows itself even while the panel covers part of the line.
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
// How far your line opens out: up to the rule before the feel.
const write = $("write");
const reach = () => {
  const stop = $("sep-feel");
  write.style.setProperty(
    "--reach",
    `${stop.offsetLeft - write.offsetLeft - 6}px`,
  );
};
new ResizeObserver(reach).observe(dock);

// On a tablet the case and the feel are lists, not switches: picking
// from one picks the switch's choice, and the switch keeps the list right.
const choose = (group: HTMLElement) => (id: string) => {
  const radio = group.querySelector<HTMLInputElement>(`input[value="${id}"]`);
  if (!radio) return;
  radio.checked = true;
  radio.dispatchEvent(new Event("change", { bubbles: true }));
};
const feelMenu = list($("feel-chip"), choose(feel));
const caseMenu = list($("case-chip"), choose($("case")));
feel.addEventListener("change", (e) =>
  feelMenu.set((e.target as HTMLInputElement).value),
);
$("case").addEventListener("change", (e) =>
  caseMenu.set((e.target as HTMLInputElement).value),
);

// A feel brings the hold and stagger it reads best at.
feel.addEventListener("change", (e) => {
  const f = FEELS.find((f) => f.id === (e.target as HTMLInputElement).value);
  if (f) apply({ ...settings, feel: f.id, hold: f.hold, stagger: f.stagger });
  run(d.text);
});

// A new case: the lines are measured again in it, and the alphabet follows.
$("case").addEventListener("change", (e) => {
  lettercase = (e.target as HTMLInputElement).value as Case;
  d.set(engine());
  fit();
  run(d.text);
});

// Reset hides itself once it's done, so focus moves on to Copy settings.
reset.addEventListener("click", () => {
  if (document.activeElement === reset) $("copy-settings").focus();
  apply({ ...DEFAULTS });
  run(d.text);
});

// Escape steps out of your line, leaving it as typed.
$<HTMLInputElement>("own").addEventListener("keydown", (e) => {
  if (e.key === "Escape") (e.target as HTMLInputElement).blur();
});

// Clearing your line hands the sheet back to its own lines.
$<HTMLInputElement>("own").addEventListener("input", (e) => {
  if (own === null || (e.target as HTMLInputElement).value.trim()) return;
  own = null;
  fit();
  run(LINES[next]);
});

$<HTMLFormElement>("write").addEventListener("submit", (e) => {
  e.preventDefault();
  const input = $<HTMLInputElement>("own");
  own = input.value.trim().replace(/\s+/g, " ") || null;
  fit();
  run(own ?? LINES[next]);
});

// Copying.
const asCode = (s: Settings) => {
  const changed = (Object.keys(DEFAULTS) as (keyof Settings)[]).filter(
    (k) => s[k] !== DEFAULTS[k],
  );
  if (!changed.length) return "decoder(el, DEFAULTS);";
  const fields = changed.map((k) => `${k}: ${JSON.stringify(s[k])}`);
  return `decoder(el, { ...DEFAULTS, ${fields.join(", ")} });`;
};

const copy = async (button: HTMLButtonElement, text: string) => {
  const label = button.dataset.label ?? button.textContent?.trim() ?? "";
  button.dataset.label = label;
  // Held at its own width, so "Copied" doesn't move its neighbour.
  button.style.minWidth = `${button.offsetWidth}px`;
  const ok = await navigator.clipboard.writeText(text).then(
    () => true,
    () => false,
  );
  say(button, ok ? "Copied" : "Couldn’t copy");
  status.textContent = ok
    ? `${label}: copied`
    : "Couldn’t copy. Your browser blocked the clipboard; try again.";
  setTimeout(() => say(button, label), 1600);
};

$<HTMLButtonElement>("copy-settings").addEventListener("click", (e) =>
  copy(e.currentTarget as HTMLButtonElement, asCode(engine())),
);
$<HTMLButtonElement>("copy-file").addEventListener("click", (e) =>
  copy(e.currentTarget as HTMLButtonElement, source),
);

// A new size: land the line again at it and redraw under it.
const relayout = () => {
  fit();
  place(d.text);
  d.land(d.text);
  measure();
  if (!running && !over) {
    clearTimeout(timer);
    timer = window.setTimeout(cycle, REST);
  }
};

let resized = 0;
new ResizeObserver(() => {
  // The bar growing or shrinking moves the sheet, not its measure.
  if (growing?.playState === "running") return;
  cancelAnimationFrame(resized);
  resized = requestAnimationFrame(relayout);
}).observe(sheet);

// The size slider, in the Size chip's panel.
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

document.fonts.load(`800 ${MAX}px "Geist Variable"`).finally(() => {
  show();
  fit();
  run(LINES[0]);
  sheet.classList.add("ready");
});
