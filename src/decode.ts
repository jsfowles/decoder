// A text decode. Each letter scrambles through look-alikes of its own width,
// so the line settles without moving. One file, no dependencies.

export type Settings = {
  /** Frames each letter scrambles before it lands, at 60 a second. */
  hold: number;
  /** Frames between one letter landing and the next. */
  stagger: number;
  /** How close in width a look-alike has to be, as a share of the letter's. */
  match: number;
  /** Frames a letter under the pointer stays scrambled. */
  heat: number;
  /** Frames the letters either side of it scramble. */
  spill: number;
  /** The characters the scramble draws from. */
  alphabet: string;
  /**
   * How a letter scrambles and lands. Sharp swaps every frame in full ink
   * and snaps. Soft swaps slower as it nears landing, faded, and inks in
   * once it lands. Focus shimmers out of focus and pulls sharp as it lands.
   */
  feel: "sharp" | "soft" | "focus";
};

export const DEFAULTS: Settings = {
  hold: 4,
  stagger: 1,
  match: 0.12,
  heat: 10,
  spill: 5,
  alphabet: "ABCDEFGHIJKLMNOPQRSTUVWXYZ#%$&/=+",
  feel: "sharp",
};

/** Each letter's look-alikes. Null for spaces and punctuation, which hold. */
export type Pools = (string[] | null)[];

export type Frame = {
  /** The text it's settling on. */
  text: string;
  /** What's on screen now. */
  shown: string;
  pools: Pools;
  /** Which letters are still scrambling. */
  live: boolean[];
  /** True once it has come to rest on `text`. */
  settled: boolean;
  /** The element the letters are drawn in. */
  face: HTMLElement;
};

export type Options = {
  /** Scramble the letters under a moving pointer. */
  graze?: boolean;
  /** Called after every frame drawn, and once when it comes to rest. */
  onFrame?: (frame: Frame) => void;
};

const FRAME = 1000 / 60;
// Writes are paced to 60Hz: a 120Hz display writing every refresh flickered
// twice as fast. Three quarters of a frame, so jitter never skips one.
const DUE = FRAME * 0.75;
// A break that takes no room, so a long word can still wrap there.
const ZWSP = "​";

// The fewest look-alikes a letter gets. A letter with nothing near its width,
// like a narrow I, is topped up with the nearest widths there are rather
// than left still while the rest scramble. Pinned to its own width, a
// stand-in a little wider can't move anything beside it.
const LEAST = 3;

// How a letter is drawn: its opacity, and its blur in em.
type Look = { o: number; b: number };
const INK: Look = { o: 1, b: 0 };
// Frames a letter takes to come up to full ink once it lands: a beat
// longer in focus, to pull sharp.
const FADE = { sharp: 0, soft: 16, focus: 17 };

/**
 * For each character, the alphabet's characters within `match` of its
 * width, or its nearest few when too few are that close.
 */
export const poolsFor = (
  chars: string[],
  width: (ch: string) => number,
  alphabet: string,
  match: number,
): Pools => {
  const pool = [...alphabet].map((ch) => ({ ch, w: width(ch) }));
  if (!pool.length) return chars.map(() => null);
  return chars.map((ch) => {
    // Any letter or digit, accented and non-Latin included.
    if (!/[\p{L}\p{N}]/u.test(ch)) return null;
    const w = width(ch);
    const near = pool.filter(
      (p) => Math.abs(p.w - w) <= Math.max(w * match, 0.5),
    );
    if (near.length >= Math.min(LEAST, pool.length))
      return near.map((p) => p.ch);
    // The nearest widths, kept in the alphabet's order.
    const nearest = new Set(
      [...pool]
        .sort((a, b) => Math.abs(a.w - w) - Math.abs(b.w - w))
        .slice(0, LEAST),
    );
    return pool.filter((p) => nearest.has(p)).map((p) => p.ch);
  });
};

// Each character's width, set in `host` exactly as the page sets it: its
// variable axes, features and tracking included, which a canvas can't see.
const widthsIn = (host: HTMLElement, chars: string[]) => {
  const probe = document.createElement("span");
  probe.setAttribute("aria-hidden", "true");
  probe.style.cssText =
    "position:absolute;left:0;top:0;visibility:hidden;white-space:pre;pointer-events:none";
  const unique = [...new Set(chars)];
  for (const ch of unique) {
    const box = document.createElement("span");
    box.style.display = "inline-block";
    box.textContent = ch;
    probe.append(box);
  }
  host.append(probe);
  const widths = new Map(
    unique.map((ch, i) => [
      ch,
      probe.children[i].getBoundingClientRect().width,
    ]),
  );
  probe.remove();
  return (ch: string) => widths.get(ch) ?? 0;
};

const still = () =>
  typeof matchMedia !== "undefined" &&
  matchMedia("(prefers-reduced-motion: reduce)").matches;

const pick = (pool: string[]) => pool[Math.floor(Math.random() * pool.length)];

/**
 * Takes over `el`'s text. Screen readers get the real text in a hidden
 * copy; the letters you see are drawn in an aria-hidden face beside it.
 * Wait for your fonts before the first decode: the widths are measured.
 */
export const decoder = (
  el: HTMLElement,
  settings: Settings = DEFAULTS,
  options: Options = {},
) => {
  let s = { ...settings };
  const said = document.createElement("span");
  said.style.cssText =
    "position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap";
  const face = document.createElement("span");
  face.setAttribute("aria-hidden", "true");
  // CSS uppercase would show capitals but measure lowercase, so the text
  // itself is cased to match.
  const upper = getComputedStyle(el).textTransform === "uppercase";
  const cased = (t: string) => (upper ? t.toUpperCase() : t);

  let text = cased(el.textContent?.trim() ?? "");
  let chars = [...text];
  let pools: Pools = chars.map(() => null);
  let mode: "rest" | "decode" | "graze" = "rest";
  let heat: number[] = [];
  let fresh = false;
  // Each letter's width and where lines break, read off the plain text.
  let plan: { widths: number[]; breaks: Set<number> } | null = null;
  // While it runs, every letter sits in a box pinned to its own width, so
  // a look-alike a hair wider or narrower can't move anything beside it.
  let boxes: (HTMLElement | null)[] | null = null;
  let raf = 0;
  let t = 0;
  let last = 0;
  let wrote = -Infinity;

  said.textContent = text;
  face.textContent = text;
  el.replaceChildren(said, face);

  const measurePools = () => {
    const width = widthsIn(face, [...chars, ...s.alphabet]);
    pools = poolsFor(chars, width, s.alphabet, s.match);
  };

  // Reads each letter's box and where each line starts, off the plain text.
  const measure = () => {
    face.style.whiteSpace = "";
    face.textContent = text;
    boxes = null;
    const node = face.firstChild;
    const widths: number[] = [];
    const breaks = new Set<number>();
    if (node instanceof Text) {
      const range = document.createRange();
      const rects: DOMRect[] = [];
      let top: number | null = null;
      let off = 0;
      chars.forEach((ch, i) => {
        range.setStart(node, off);
        range.setEnd(node, off + ch.length);
        off += ch.length;
        const r = range.getBoundingClientRect();
        rects.push(r);
        if (!ch.trim() || ch === ZWSP) return;
        if (top !== null && r.top > top + r.height / 2) breaks.add(i);
        if (top === null || r.top > top + r.height / 2) top = r.top;
      });
      // A letter's box is how far the next one starts from it: WebKit
      // leaves negative tracking out of a letter's own rect, so pinned to
      // that, the line would run wider than the text it settles into. The
      // last on a line has no next, so it gets its rect less the gap the
      // rest of its line showed between rect and advance.
      const sameLine = (a: DOMRect, b: DOMRect) =>
        Math.abs(a.top - b.top) < a.height / 2;
      let lineStart = 0;
      rects.forEach((r, i) => {
        const next = rects[i + 1];
        if (next && sameLine(r, next)) {
          widths.push(next.left - r.left);
          return;
        }
        const gaps = rects
          .slice(lineStart, i)
          .map((p, j) => p.width - widths[lineStart + j])
          .sort((a, b) => a - b);
        const gap = gaps.length ? gaps[Math.floor(gaps.length / 2)] : 0;
        widths.push(r.width - gap);
        lineStart = i + 1;
      });
    }
    plan = { widths, breaks };
  };

  const pin = () => {
    if (!plan) measure();
    const { widths, breaks } = plan!;
    const parts: Node[] = [];
    const pinned = (w: number) => {
      const box = document.createElement("span");
      box.style.cssText = `display:inline-block;width:${w}px`;
      return box;
    };
    boxes = chars.map((ch, i) => {
      if (breaks.has(i)) {
        // The space the line broke at becomes the break.
        const prev = parts.at(-1);
        const newline = document.createTextNode("\n");
        if (prev instanceof HTMLElement && prev.dataset.gap !== undefined)
          parts[parts.length - 1] = newline;
        else parts.push(newline);
      }
      // Spaces are pinned too: one kerned against the letter beside it
      // would widen on its own between two boxes and push the line apart.
      if (!ch.trim() || ch === ZWSP) {
        const gap = pinned(widths[i]);
        gap.dataset.gap = "";
        parts.push(gap);
        return null;
      }
      const box = pinned(widths[i]);
      box.dataset.i = String(i);
      box.textContent = ch;
      parts.push(box);
      return box;
    });
    // One line holds by not wrapping; more by their breaks.
    face.style.whiteSpace = breaks.size ? "pre" : "nowrap";
    face.replaceChildren(...parts);
  };

  const draw = (
    shown: string[],
    live: boolean[],
    settled = false,
    looks?: Look[],
  ) => {
    if (settled) {
      boxes = null;
      plan = null;
      face.style.whiteSpace = "";
      face.textContent = text;
    } else {
      if (!boxes) pin();
      boxes!.forEach((box, i) => {
        if (!box) return;
        if (box.textContent !== shown[i]) box.textContent = shown[i];
        const look = looks?.[i];
        if (!look) return;
        // Kept on its own layer while it fades and blurs; a letter in full
        // ink doesn't need one.
        if (look !== INK && !box.style.willChange)
          box.style.willChange = "opacity, filter";
        const o = String(Math.round(look.o * 100) / 100);
        const f = look.b >= 0.001 ? `blur(${look.b.toFixed(3)}em)` : "";
        if (box.style.opacity !== o) box.style.opacity = o;
        if (box.style.filter !== f) box.style.filter = f;
      });
    }
    options.onFrame?.({
      text,
      shown: shown.join(""),
      pools,
      live,
      settled,
      face,
    });
  };

  const rest = () => {
    cancelAnimationFrame(raf);
    raf = 0;
    mode = "rest";
    draw(
      chars,
      chars.map(() => false),
      true,
    );
  };

  // A letter mid-scramble, `p` of the way to landing.
  const lookOf = (p: number): Look =>
    s.feel === "sharp"
      ? INK
      : s.feel === "soft"
        ? // Faint while it scrambles, its ink climbing as it nears landing,
          // so with the fade after it lands the whole rise is one S.
          { o: 0.28 + 0.37 * p * p, b: 0 }
        : // Focus eases out of its blur, and lands still a little soft so
          // the swap to the real letter is hidden, then pulls sharp.
          { o: 0.35 + 0.3 * p, b: 0.02 + 0.045 * (1 - p) ** 2 };
  // Frames between swaps: every one when sharp; when soft, easing from
  // every frame to every third as it lands, settling without stepping; a
  // steady shimmer in focus, which the blur smooths.
  const gapOf = (p: number) =>
    s.feel === "sharp" ? 0 : s.feel === "soft" ? 1 + 2 * p * p : 2;

  // Per letter, for the run: what it shows and when it next swaps; whether
  // it was scrambling; once it lands, when, and how it looked then.
  let shown: string[] = [];
  let next: number[] = [];
  let was: boolean[] = [];
  let landed: number[] = [];
  let left: Look[] = [];

  const tick = (now: number) => {
    raf = 0;
    const dt = last ? Math.min(FRAME * 3, now - last) : FRAME;
    last = now;
    const before = Math.floor(t / FRAME);
    t += dt;
    const frame = t / FRAME;

    let live: boolean[];
    let progress: (i: number) => number;
    if (mode === "decode") {
      const at = (i: number) => i * s.stagger + s.hold;
      live = chars.map((_, i) => pools[i] !== null && frame < at(i));
      progress = (i) => Math.min(1, frame / at(i));
    } else if (mode === "graze") {
      const cooled = Math.floor(frame) - before;
      for (let i = 0; i < heat.length; i++)
        heat[i] = Math.max(0, heat[i] - cooled);
      live = chars.map((_, i) => pools[i] !== null && heat[i] > 0);
      progress = (i) => 1 - Math.min(1, heat[i] / Math.max(1, s.heat));
    } else return;

    live.forEach((on, i) => {
      // A letter starting to scramble swaps at once.
      if (on && !was[i]) next[i] = frame;
      if (!on && was[i]) {
        landed[i] = frame;
        left[i] = lookOf(progress(i));
      }
    });
    was = live;
    const fade = FADE[s.feel];
    const fading = (i: number) => frame - landed[i] < fade;
    if (!live.includes(true) && !chars.some((_, i) => fading(i))) return rest();

    // Fresh heat answers on the very next frame.
    if (fresh || t - wrote >= DUE) {
      fresh = false;
      wrote = t;
      const looks = chars.map((ch, i) => {
        if (live[i]) {
          const p = progress(i);
          if (frame >= next[i]) {
            shown[i] = pick(pools[i]!);
            next[i] = frame + gapOf(p);
          }
          return lookOf(p);
        }
        shown[i] = ch;
        if (!fading(i)) return INK;
        const e = 1 - (1 - (frame - landed[i]) / fade) ** 3;
        return { o: left[i].o + (1 - left[i].o) * e, b: left[i].b * (1 - e) };
      });
      draw(shown, live, false, s.feel === "sharp" ? undefined : looks);
    }
    raf = requestAnimationFrame(tick);
  };

  // The first frame draws at once, so a run starts on the input that asked.
  const start = () => {
    cancelAnimationFrame(raf);
    t = 0;
    last = 0;
    wrote = -Infinity;
    shown = [...chars];
    next = chars.map(() => 0);
    was = chars.map(() => false);
    landed = chars.map(() => -Infinity);
    left = chars.map(() => INK);
    tick(performance.now());
  };

  // The letter under a point: its box while running, else a caret in the
  // plain text.
  const letterAt = (e: PointerEvent) => {
    const box = e.target;
    if (box instanceof HTMLElement && box.parentNode === face && box.dataset.i)
      return Number(box.dataset.i);
    const doc = document as Document & {
      caretPositionFromPoint?: (
        x: number,
        y: number,
      ) => { offsetNode: Node; offset: number } | null;
    };
    let node: Node | undefined;
    let offset = 0;
    if (doc.caretPositionFromPoint) {
      const p = doc.caretPositionFromPoint(e.clientX, e.clientY);
      if (p) ({ offsetNode: node, offset } = p);
    } else {
      const r = doc.caretRangeFromPoint?.(e.clientX, e.clientY);
      if (r) ({ startContainer: node, startOffset: offset } = r);
    }
    if (!node || node.parentNode !== face || !(node instanceof Text))
      return null;
    if (!chars.length) return null;
    // A caret lands on the nearer edge of a letter: past its middle, that's
    // after it. The letter under the point is the one its box holds.
    let at = offset;
    if (at > 0) {
      const range = document.createRange();
      range.setStart(node, at - 1);
      range.setEnd(node, at);
      if (e.clientX <= range.getBoundingClientRect().right) at -= 1;
    }
    const i = [...node.data.slice(0, at)].length;
    return Math.min(chars.length - 1, i);
  };

  // Heats letter `i` to `hot` and its neighbours to `spill`, starting a
  // graze if one isn't running. Ignored mid-decode.
  const heatAt = (i: number, hot: number, spill: number) => {
    if (mode === "decode" || document.hidden || still()) return;
    if (i < 0 || i >= chars.length) return;
    const begin = mode !== "graze";
    if (begin) {
      mode = "graze";
      heat = chars.map(() => 0);
      measurePools();
      measure();
    }
    heat[i] = Math.max(heat[i], hot);
    if (i > 0) heat[i - 1] = Math.max(heat[i - 1], spill);
    if (i < heat.length - 1) heat[i + 1] = Math.max(heat[i + 1], spill);
    fresh = true;
    // Heated first: the first frame draws at once and needs something hot.
    if (begin) start();
  };

  const onMove = (e: PointerEvent) => {
    if (mode === "decode") return;
    const i = letterAt(e);
    if (i !== null) heatAt(i, s.heat, s.spill);
  };
  if (options.graze) el.addEventListener("pointermove", onMove);

  const settle = (to: string) => {
    text = cased(to);
    chars = [...text];
    said.textContent = text;
  };

  measurePools();

  return {
    /** Decodes to `to`, or replays the current text. Interrupts any run. */
    decode(to = text) {
      settle(to);
      measurePools();
      if (still()) return rest();
      mode = "decode";
      measure();
      start();
    },
    /** Writes `to` at once, no scramble. */
    land(to: string) {
      settle(to);
      measurePools();
      rest();
    },
    /** New settings. A run in flight picks them up. */
    set(next: Settings) {
      s = { ...next };
      measurePools();
      if (mode === "rest") rest();
    },
    /**
     * Scrambles the letter at `i` as a graze would, for `heat` frames: alone,
     * or with `spill` its neighbours too. Call it again before then to keep
     * it going.
     */
    stir(i: number, spill = false) {
      heatAt(i, s.heat, spill ? s.spill : 0);
    },
    /** Turns grazing on or off. */
    graze(on: boolean) {
      el.removeEventListener("pointermove", onMove);
      if (on) el.addEventListener("pointermove", onMove);
    },
    get text() {
      return text;
    },
    /** Stops, and puts the plain text back. */
    teardown() {
      cancelAnimationFrame(raf);
      el.removeEventListener("pointermove", onMove);
      el.textContent = text;
    },
  };
};

export type Decoder = ReturnType<typeof decoder>;
