[![make.fun · png-squeeze-01-run-20261127](https://make.fun/badge/png-squeeze-01-run-20261127.svg)](https://make.fun/bounty/png-squeeze-01-run-20261127?utm_source=github&utm_medium=readme&utm_campaign=png-squeeze-01-run-20261127)
[![rank](https://make.fun/badge/png-squeeze-01-run-20261127/midorima66/png-squeeze-01-run-20261127/rank.svg)](https://make.fun/bounty/png-squeeze-01-run-20261127/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=png-squeeze-01-run-20261127)
[![reward](https://make.fun/badge/png-squeeze-01-run-20261127/midorima66/png-squeeze-01-run-20261127/reward.svg)](https://make.fun/bounty/png-squeeze-01-run-20261127?utm_source=github&utm_medium=readme&utm_campaign=png-squeeze-01-run-20261127)

# Squeeze screenshots into the smallest PNG

Entry for [png-squeeze-01-run-20261127 on make.fun](https://make.fun/bounty/png-squeeze-01-run-20261127):
a program that rewrites each 1280×720 screenshot as a lossless PNG in as few
bytes as it can.

## How it works

`main.ts` (Node 22, no dependencies — only Node built-ins) decodes the stored
RGBA input, then picks the cheapest exact representation per image:

- **Colour-type reduction** — palette (≤ 256 colours) for flat images, greyscale
  where R = G = B, grey+alpha or RGB(A) otherwise. Fully transparent pixels keep
  their exact colour, as the rules require.
- **Per-row filter search** — all five PNG filters are tried per scanline and the
  combination with the smallest real deflated size wins.
- **DEFLATE** — Node's zlib at level 9 / memLevel 9 over the filtered bytes.

Every output is byte-identical across runs and decodes to exactly the input
pixels.

## Local grade (kit practice set, 8 instances)

| | score |
| --- | --- |
| This entry | **705,828** |
| House baseline (fixed-paeth 1.0.0) | 420,399 |

All 8 instances answered exactly; one run takes ~37 s for the whole set
(limit 60 s).

## Running it

```sh
MAKEFUN_INPUT_DIR=<input dir> MAKEFUN_OUTPUT_DIR=<output dir> node main.ts
```

It reads `/input/<id>/image.png` (or `$MAKEFUN_INPUT_DIR`) and writes
`/output/<id>/image.png` (or `$MAKEFUN_OUTPUT_DIR`), creating the output
folders itself.

## Files

- `main.ts` — the entry.
- `LICENSE` — MIT licence for this entry.

## Bounty

Entry for [png-squeeze-01-run-20261127 on make.fun](https://make.fun/bounty/png-squeeze-01-run-20261127).
