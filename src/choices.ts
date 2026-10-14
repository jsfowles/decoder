import { DEFAULTS, type Settings } from "./decode";

export const ALPHABETS: { id: string; label: string; chars: string }[] = [
  { id: "caps", label: "A–Z #%$&/=+", chars: DEFAULTS.alphabet },
  { id: "letters", label: "A–Z", chars: "ABCDEFGHIJKLMNOPQRSTUVWXYZ" },
  { id: "digits", label: "0–9", chars: "0123456789" },
  { id: "symbols", label: "#%$&/=+*<>", chars: "#%$&/=+*<>" },
];

// The line's case. The text itself is cased, not just shown that way, so
// its letters are measured as they're seen; the alphabet follows suit.
export type Case = "upper" | "lower" | "title";
export const CASES: { id: Case; label: string; name: string }[] = [
  { id: "upper", label: "AA", name: "Uppercase" },
  { id: "lower", label: "aa", name: "Lowercase" },
  { id: "title", label: "Aa", name: "Title case" },
];

export const inCase = (text: string, c: Case) => {
  const lower = text.toLowerCase();
  if (c === "upper") return text.toUpperCase();
  if (c === "lower") return lower;
  return lower.replace(
    /(^|\s)(\p{L})/gu,
    (_, gap, ch) => gap + ch.toUpperCase(),
  );
};

// The alphabet in the line's case: title case draws on both.
export const alphabetIn = (chars: string, c: Case) =>
  c === "upper"
    ? chars.toUpperCase()
    : c === "lower"
      ? chars.toLowerCase()
      : [...new Set(chars.toUpperCase() + chars.toLowerCase())].join("");

// How a letter scrambles and lands, each with the hold and stagger it
// reads best at.
export const FEELS: {
  id: Settings["feel"];
  label: string;
  about: string;
  hold: number;
  stagger: number;
}[] = [
  {
    id: "sharp",
    label: "Sharp",
    about: "Swaps every frame in full ink, then snaps into place.",
    hold: DEFAULTS.hold,
    stagger: DEFAULTS.stagger,
  },
  {
    id: "soft",
    label: "Soft",
    about: "Faded, easing as it lands, then inks in.",
    hold: 14,
    stagger: 1.5,
  },
  {
    id: "focus",
    label: "Focus",
    about: "Shimmers out of focus, then pulls sharp as it lands.",
    hold: 16,
    stagger: 1.5,
  },
];

// Faces with different width habits: a grotesque, a newspaper serif, a
// display serif, a condensed, an extended and a monospace, where every
// letter is the same width.
export const FACES: {
  id: string;
  label: string;
  family: string;
  weight: number;
  tracking: string;
}[] = [
  {
    id: "geist",
    label: "Geist",
    family: '"Geist Variable"',
    weight: 800,
    tracking: "-0.03em",
  },
  {
    id: "newsreader",
    label: "Newsreader",
    family: '"Newsreader Variable"',
    weight: 600,
    tracking: "-0.02em",
  },
  {
    id: "caslon",
    label: "Caslon",
    family: '"Libre Caslon Display"',
    weight: 400,
    tracking: "-0.01em",
  },
  {
    id: "shoulders",
    label: "Big Shoulders",
    family: '"Big Shoulders Display Variable"',
    weight: 800,
    tracking: "0em",
  },
  {
    id: "unbounded",
    label: "Unbounded",
    family: '"Unbounded Variable"',
    weight: 700,
    tracking: "-0.03em",
  },

  {
    id: "mono",
    label: "JetBrains Mono",
    family: '"JetBrains Mono Variable"',
    weight: 800,
    tracking: "0em",
  },
];
