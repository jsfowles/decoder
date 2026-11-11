export const EASE = "cubic-bezier(0.23, 1, 0.32, 1)";

export const calm = () =>
  matchMedia("(prefers-reduced-motion: reduce)").matches;

export const fadeUp = (el: Element) =>
  el.animate([{ opacity: 0.25 }, { opacity: 1 }], {
    duration: 240,
    easing: EASE,
  });

// Skips the fade if one's running, so a dragged slider doesn't strobe.
export const say = (el: Element, text: string) => {
  if (el.textContent === text) return;
  el.textContent = text;
  if (!el.getAnimations().length) fadeUp(el);
};

// Reads the live height, so a change mid-animation carries on smoothly.
const glides = new WeakMap<HTMLElement, Animation>();
export const easeHeight = (el: HTMLElement, change: () => void) => {
  const from = el.getBoundingClientRect().height;
  glides.get(el)?.cancel();
  change();
  const to = el.getBoundingClientRect().height;
  el.style.overflow = "";
  if (!from || !to || Math.abs(to - from) < 1 || calm()) return;
  el.style.overflow = "clip";
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

export const track = (el: HTMLInputElement, v: number) => {
  const [lo, hi] = [Number(el.min), Number(el.max)];
  el.style.setProperty("--p", `${((v - lo) / (hi - lo)) * 100}%`);
};

export const glyphSet = (className: string, pool: string[]) => {
  const set = document.createElement("span");
  set.className = className;
  const glyphs = new Map<string, HTMLElement>();
  for (const g of pool) {
    const span = document.createElement("span");
    span.textContent = g;
    glyphs.set(g, span);
    set.append(span);
  }
  return { set, glyphs };
};
