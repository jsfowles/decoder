# Decoder

A text decode. Each letter scrambles through look-alikes of its own width, so the line settles without moving.

**[Play with it →](https://decoder.jsfowles.com)**

It's one file, [`src/decode.ts`](src/decode.ts), with no dependencies.

## Quick start

Copy [`src/decode.ts`](src/decode.ts) into your project, then point it at some text:

```ts
import { decoder, DEFAULTS } from "./decode";

const el = document.querySelector<HTMLElement>(".decode")!;

document.fonts.ready.then(() => {
  const d = decoder(el, DEFAULTS);
  d.decode();
});
```

Wait for your fonts first. Every letter's width gets measured, and a fallback font measures differently.

## Recipes

### Your own settings

Tune it in the playground and hit **Copy settings**. You only get what you changed:

```ts
decoder(el, { ...DEFAULTS, feel: "focus", hold: 16, stagger: 1.5 });
```

### A new line

`decode` takes the text to land on. Called mid-run, it drops that run and starts on the new text.

```ts
d.decode("SIGNAL FOUND");
```

`land` writes text at once, no scramble.

### Scramble under the pointer

Pass `graze` and the letters under a moving pointer scramble and settle again:

```ts
decoder(el, DEFAULTS, { graze: true });
```

Turn it on and off later with `d.graze(on)`. To scramble a letter yourself, call `d.stir(i)`, or `d.stir(i, true)` to take its neighbours with it.

### Draw alongside it

`onFrame` gets every frame: what's showing, which letters are still live, and each letter's look-alikes. The playground's columns are drawn from it.

```ts
decoder(el, DEFAULTS, {
  onFrame: ({ shown, live, settled }) => {
    if (settled) console.log("landed on", shown);
  },
});
```

### Clean up

`d.teardown()` stops it and puts the plain text back.

## Settings

| Setting    | Default          | Does                                                                        |
| ---------- | ---------------- | --------------------------------------------------------------------------- |
| `hold`     | `4`              | Frames each letter scrambles before it lands, at 60 a second.               |
| `stagger`  | `1`              | Frames between one letter landing and the next.                             |
| `match`    | `0.12`           | How close in width a look-alike has to be, as a share of the letter's.      |
| `heat`     | `10`             | Frames a letter under the pointer stays scrambled.                          |
| `spill`    | `5`              | Frames the letters either side of it scramble.                              |
| `alphabet` | `A–Z #%$&/=+`    | The characters the scramble draws from.                                     |
| `feel`     | `"sharp"`        | `sharp` swaps in full ink and snaps. `soft` fades in as it lands. `focus` pulls sharp out of a blur. |

Soft and focus read best slower: the playground pairs them with a `hold` of 14 and 16, and a `stagger` of 1.5.

## Good to know

- It checks reduced motion for you. With `prefers-reduced-motion` set, the text just lands.
- Screen readers get the real text in a hidden copy. The scramble is drawn beside it, hidden from them.
- A letter with nothing near its width, like a narrow I, still scrambles: it borrows the nearest few widths there are, and sits in a box pinned to its own width so nothing beside it moves.
- The scramble only draws from `alphabet`, so lowercase text wants a lowercase alphabet. `text-transform: uppercase` is fine: the text gets cased to match.
- I built it in Chrome. Check Safari and Firefox with your fonts.

## The playground

```bash
npm install
npm run dev
```

It's an Astro page. `npm run check` typechecks and formats. The effect is `src/decode.ts`, everything else is the playground.

## License

MIT. Geist, Geist Mono, Newsreader, Libre Caslon Display, Big Shoulders Display, Unbounded and JetBrains Mono are under the SIL Open Font License.
