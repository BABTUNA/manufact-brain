# Manufact Brain style, for agents

Read this before touching anything a person sees: the web app, the extension popup and Guide me overlay, the README, slides, screenshots. The app's live tokens are in `bridge/public/bb.css`; the brand tokens are in `assets/brand.css`.

## Files to use, never redraw

| Need | Use |
|---|---|
| Logo on white or paper | `assets/logo/manufactbrain-mark.svg` (the node brain) |
| Logo on ink or dark surfaces | `assets/logo/manufactbrain-mark-dark.svg` |
| Logo on the violet field | `assets/logo/manufactbrain-mark-on-violet.svg` |
| Logo in one colour | `assets/logo/manufactbrain-mark-mono.svg` (set `color`) |
| Wordmark ("Manufact Brain") | `assets/logo/manufactbrain-wordmark.svg` (light), `-dark.svg` (ink), `-on-violet.svg` |
| App icon, favicon | `assets/logo/manufactbrain-icon.svg` (paper tile), `-icon-dark.svg`, `-icon-violet.svg`; PNGs in `assets/icons/icon-{16..512}.png` |
| README or social banner | `assets/banner/readme-banner.png` (paper) or `readme-banner-dark.png` |
| Slides, forms, anything that can't take SVG | `assets/png/`: transparent logos, 1920×1080 covers (`cover-white`, `-dark`, `-violet`), 1080×1080 squares |

All SVGs are outlined shapes, no font needed. Don't redraw the node brain, don't retype "Manufact Brain" as a logo, don't recolour the mark outside the files above. Copies live in `bridge/assets/` (the web app) and `extension/icons/`; update them when `assets/` changes.

## The mark

Seven nodes in two lobes, joined by edges: a brain drawn as the graph agents share. The centre node has a hollow core. Keep the edges; without them it is just dots.

## Colour

```
Violet        #6B5CFF   the nodes, "Brain", fills, dots, the Guide me glow
Violet deep   #5546E0   edges, pressed fills
Violet ink    #4A3BD6   buttons and violet text (white on it is 7:1)
Violet soft   #E9E6FF   tints
Violet light  #B9B1FF   the mark and "Brain" on ink
Ink           #111318   text, dark surfaces
Paper         #F5F6F8   page background, icon tile
White         #FFFFFF   cards
Slate         #646B78   muted text
Line          #E2E5EB   borders
Red           #D93025   errors only
```

Violet is a fill colour; it is too light for text on white, so text and white-on-violet buttons use violet ink. One violet job per screen: an accent, a primary button, or the highlighted element. No greens, no other hues. In code use the variables (`--orange`, `--orange-ink`, … in `bb.css`; the names are historical and now hold violet), not hex values.

## Type

```
Display   Archivo 800, width 100, letter-spacing -0.02em   headings, the wordmark
Body      Onest 400/500/700                                  everything else
Mono      JetBrains Mono 500/600                             kickers, labels, numbers, logs
```

Kickers are 11px mono, uppercase, 2px tracking, violet ink. Numbers are tabular.

## Voice

Short, plain sentences, second person. Say who taught a workflow or which agent handed in. Never claim an agent succeeded when the judge disagreed. The mark is a logo, not a character: no brain puns in UI copy.

## Regenerating

In `assets/render/`: `python3 extract.py` outlines the words from Archivo, `node compose.mjs ..` draws the mark and writes every SVG and render page, `bash render.sh` makes the icons and banners, `bash raster.sh` the PNG set.
