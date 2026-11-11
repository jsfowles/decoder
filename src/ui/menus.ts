import { calm, EASE } from "./fx";

const ROWS =
  ".lead, .row-label, .write, .sizer, .case, .drop:has(#alphabet), .panel";

// On a phone, Settings opens the whole bar and animates its height.
export const menus = (dock: HTMLElement, phone: MediaQueryList) => {
  const chips = [
    ...dock.querySelectorAll<HTMLButtonElement>("button[aria-expanded]"),
  ];
  const isOpen = (chip: HTMLElement) =>
    chip.getAttribute("aria-expanded") === "true";
  const opens = (chip: HTMLElement) =>
    chip.id === "settings" ? dock : (chip.nextElementSibling as HTMLElement);
  const within = (chip: HTMLElement, node: Node) =>
    chip.contains(node) || opens(chip).contains(node);
  // Chips on the bar's own row aren't inside Settings, so opening one closes it.
  const holds = (c: HTMLElement, chip: HTMLElement) =>
    c.id === "settings" ? !!chip.closest(ROWS) : opens(c).contains(chip);
  const smooth = () => phone.matches && !calm();

  const close = (chip: HTMLButtonElement) => {
    if (chip.id === "settings" && isOpen(chip) && smooth()) return fold(chip);
    chip.setAttribute("aria-expanded", "false");
    for (const c of chips) if (c !== chip && holds(chip, c)) close(c);
  };

  let growing: Animation | null = null;
  const glide = (from: number, to: number, ms: number) => {
    growing?.cancel();
    dock.style.overflow = "clip";
    growing = dock.animate([{ height: `${from}px` }, { height: `${to}px` }], {
      duration: ms,
      easing: EASE,
    });
    return growing;
  };
  // Both pick up from the current height and opacity, so you can reverse mid-way.
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
    glide(from, to, 360).onfinish = () => (dock.style.overflow = "");
  };
  const fold = (chip: HTMLButtonElement) => {
    const from = dock.getBoundingClientRect().height;
    growing?.cancel();
    // Measure the closed height without painting it.
    chip.setAttribute("aria-expanded", "false");
    const to = dock.getBoundingClientRect().height;
    chip.setAttribute("aria-expanded", "true");
    dock.classList.add("folding");
    const fades = [...dock.querySelectorAll<HTMLElement>(ROWS)].map((row) =>
      row.animate(
        [{ opacity: getComputedStyle(row).opacity }, { opacity: 0 }],
        {
          duration: 150,
          easing: EASE,
          fill: "forwards",
        },
      ),
    );
    glide(from, to, 240).onfinish = () => {
      for (const f of fades) f.cancel();
      dock.classList.remove("folding");
      dock.style.overflow = "";
      chip.setAttribute("aria-expanded", "false");
      for (const c of chips) if (c !== chip && holds(chip, c)) close(c);
    };
  };

  const toggle = (chip: HTMLButtonElement, open = !isOpen(chip)) => {
    for (const c of chips) if (c !== chip && !holds(c, chip)) close(c);
    if (open) chip.setAttribute("aria-expanded", "true");
    else close(chip);
  };

  document.addEventListener("pointerdown", (e) => {
    for (const c of chips.filter(isOpen))
      if (!within(c, e.target as Node)) close(c);
  });
  // Tabbing away closes a popup. Not Settings: on a phone its rows are the bar.
  for (const c of chips.filter((c) => c.id !== "settings"))
    for (const el of [c, opens(c)])
      el.addEventListener("focusout", (e) => {
        const to = e.relatedTarget as Node | null;
        if (to && isOpen(c) && !within(c, to)) close(c);
      });
  dock.addEventListener("keydown", (e) => {
    const chip = chips.filter(isOpen).at(-1);
    if (e.key !== "Escape" || !chip) return;
    close(chip);
    chip.focus();
  });

  const settings = dock.querySelector<HTMLButtonElement>("#settings")!;
  settings.addEventListener("click", () => {
    if (isOpen(settings) && !dock.classList.contains("folding"))
      return close(settings);
    if (smooth()) unfold(settings);
    else toggle(settings, true);
  });

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
    // Opened by keyboard, focus the chosen option. By pointer, focus the list so
    // no ring shows.
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

  return {
    toggle,
    list,
    gliding: () => growing?.playState === "running",
  };
};
