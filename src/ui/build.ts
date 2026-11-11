import type { Frame } from "../decode";
import { glyphSet } from "./fx";

export type Col = {
  el: HTMLElement;
  glyphs: Map<string, HTMLElement>;
  on?: HTMLElement;
  mark?: HTMLElement;
  live?: boolean;
};

const stateOf = new WeakMap<HTMLElement, Col>();
export const colOf = (el: HTMLElement) => stateOf.get(el)!;

export const fillCol = (
  col: HTMLElement,
  pool: string[],
  across: number,
  short: boolean,
  tall: number,
) => {
  const room = across * tall;
  const { set, glyphs } = glyphSet("set", pool.slice(0, room));
  set.style.setProperty("--across", String(across));
  const more = document.createElement("span");
  more.className = "more";
  const rest = pool.length - room;
  more.textContent = rest > 0 ? `+${rest}${short ? "" : " more"}` : "";
  col.dataset.n = String(pool.length);
  col.dataset.hidden = String(Math.max(0, rest));
  col.querySelector(".set")?.remove();
  col.querySelector(".more")?.remove();
  col.append(set, more);
  const state = stateOf.get(col);
  if (state) Object.assign(state, { glyphs, on: undefined, mark: undefined });
  else stateOf.set(col, { el: col, glyphs });
  return set;
};

// A repeated letter gets one entry, marked ×N.
export const fillIndex = (
  index: HTMLElement,
  text: string[],
  pools: Frame["pools"],
  widthAt: (i: number) => number,
  fresh: boolean,
) => {
  index.replaceChildren();
  const seen = new Set<string>();
  const times = new Map<string, number>();
  pools.forEach((pool, i) => {
    if (pool) times.set(text[i], (times.get(text[i]) ?? 0) + 1);
  });
  return pools.map((pool, i): Col | null => {
    if (!pool || seen.has(text[i])) return null;
    seen.add(text[i]);
    const el = document.createElement("div");
    el.className = "entry";
    if (!fresh) el.style.animation = "none";
    const w = String(Math.round(widthAt(i)));
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
    const { set, glyphs } = glyphSet("pool", pool);
    el.append(ch, about, set);
    index.append(el);
    return { el, glyphs };
  });
};
