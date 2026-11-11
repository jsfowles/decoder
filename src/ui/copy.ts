import { DEFAULTS, type Settings } from "../decode";
import { say } from "./fx";

// The settings as a `decoder()` call, listing only what differs from DEFAULTS.
export const asCode = (s: Settings) => {
  const changed = (Object.keys(DEFAULTS) as (keyof Settings)[]).filter(
    (k) => s[k] !== DEFAULTS[k],
  );
  if (!changed.length) return "decoder(el, DEFAULTS);";
  const fields = changed.map((k) => `${k}: ${JSON.stringify(s[k])}`);
  return `decoder(el, { ...DEFAULTS, ${fields.join(", ")} });`;
};

// Copies `text`, flashes the result on the button and announces it in
// `status` (a live region).
export const copy = async (
  button: HTMLButtonElement,
  text: string,
  status: HTMLElement,
) => {
  const label = button.dataset.label ?? button.textContent?.trim() ?? "";
  button.dataset.label = label;
  // Lock the width so "Copied" doesn't shift the next button.
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
