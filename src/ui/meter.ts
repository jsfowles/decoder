import { calm } from "./fx";

// A width bracket that follows the pointer across columns. It grows out
// from the first column's middle, then slides and resizes to each next one
// while its number counts to the new width.
export const meter = (cols: HTMLElement) => {
  const el = document.createElement("div");
  el.className = "meter";
  el.setAttribute("aria-hidden", "true");
  for (const part of ["rule", "tick", "tick", "fig"]) {
    const span = document.createElement("span");
    span.className = part;
    el.append(span);
  }
  cols.append(el);
  const [rule, left, right, fig] = [...el.children] as HTMLElement[];
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
      // 280ms ease-out quint, matching the bracket's --duration-follow.
      const t = Math.min(1, (now - start) / 280);
      reading = Math.round(from + (to - from) * (1 - (1 - t) ** 5));
      fig.textContent = String(reading);
      if (t < 1) counting = requestAnimationFrame(step);
    };
    counting = requestAnimationFrame(step);
  };

  return (col: HTMLElement | null) => {
    const on = el.classList.contains("on");
    if (!col) {
      el.classList.remove("on");
      return;
    }
    const x = Number(col.dataset.x);
    const w = Number(col.dataset.w);
    if (!on) {
      // Collapse to the middle without a transition, so it grows from there.
      el.classList.add("instant");
      span(x, x);
      reading = 0;
      void el.offsetWidth;
      el.classList.remove("instant");
    }
    el.classList.add("on");
    span(x - w / 2 + 1, x + w / 2 - 1);
    countTo(Math.round(w));
  };
};
