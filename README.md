# Games

A pocket handheld that lives on a web page. Open it on a phone and the screen
becomes a small games console with a d-pad, A/B, and a menu of cartridges.

The first cartridge is **World Walker**: you walk around real places, built from
real OpenStreetMap geometry, and when you reach a landmark you press A and get a
photograph of it, redrawn in the console's palette, with a few paragraphs about
what you are looking at.

Three places ship today — Stanford's campus, RIT's campus, and the town of
Greece, New York — and you can travel between them in-world.

## Playing it

The site is static. Open `index.html` over HTTP (not `file://`, because it uses
ES modules):

```sh
python3 -m http.server 8000
# then visit http://localhost:8000
```

Controls: d-pad or arrow keys / WASD to walk, A (Z or Space) to look at
something, B (X) to back out, START (Enter) for the map and landmark list.
Gamepads work too. The SCREEN button cycles the palette — the default is full
colour, but the original 1989 green, the Pocket's grey, and the Game Boy Light's
teal are all there.

## How it is put together

```
engine/     the console. framebuffer, palettes, bitmap font, input, sound,
            scene stack, UI widgets, and the geo -> tilemap compiler
games/      one directory per cartridge, plus the cartridge manifest
tools/      build, fetch and validation scripts (Node, no dependencies)
data/       fetched third-party data, committed so the site needs no network
```

Two ideas do most of the work.

**The framebuffer is one byte per pixel.** Bytes 0-63 are sixteen art palettes
of four shades each; bytes 64 and up are a free palette a scene can install for
a single image. So the world keeps the disciplined four-shades-per-material look
of the era, landmark photographs get Game Boy Advance-level colour, and changing
the entire console's appearance is a lookup-table swap rather than a re-draw.

**Maps are compiled from geography, not drawn.** `engine/geo.js` takes real
`[lat, lon]` rings and polylines — building footprints, roads, paths, water,
parkland — projects them onto a tile grid at a chosen metres-per-tile, rasterizes
them, picks tile art per material with autotiled edges, and derives collision.
Adding a place means adding a bounding box and some landmark coordinates, not
drawing a map.

## Where the data comes from

Map geometry is © OpenStreetMap contributors, available under the
[Open Database Licence](https://www.openstreetmap.org/copyright). See
[`data/osm/SOURCES.md`](data/osm/SOURCES.md).

Landmark photographs are freely-licensed images from Wikimedia Commons and
Wikipedia (public domain, CC0, CC BY or CC BY-SA only — the fetcher rejects
everything else). Each one's author and licence is recorded in
[`data/photos/SOURCES.md`](data/photos/SOURCES.md) and shown in-game beneath the
picture.

Neither is fetched at runtime. A GitHub Actions job downloads and normalizes
them, then commits the result, so the published site makes no third-party
requests at all.

## Working on it

```sh
node tools/validate.mjs        # compile every level, check every landmark
node tools/browser-check.mjs   # drive the real page in Chromium, screenshot it
node tools/render-samples.mjs  # render sample screens headlessly, no browser
```

`validate.mjs` is the useful one: it compiles all three maps for real and fails
if a landmark cannot be walked to, a photo is missing its licence, a map came
out mostly impassable, or a cartridge fails to import.

To refresh the third-party data, run the **fetch-data** workflow (or edit one of
the fetch scripts, which triggers it). It needs a network the development
sandbox does not have, which is why it lives in CI.

## Adding a cartridge

A cartridge is an ES module with a default export:

```js
export default {
  id: 'my-game',
  title: 'MY GAME',
  subtitle: 'A SHORT LINE',
  icon: { w: 64, h: 48, ops: [...] },   // cover art, see engine/art.js
  create(sys) { return new MyFirstScene(); },
};
```

Add it to `games/manifest.js` and it appears on the cartridge menu. It loads on
demand, so it costs nothing until someone picks it. A scene is any object with
`enter`, `exit`, `update(dt, sys)`, `draw(screen, sys)` and, if it caches
layout, `resized(w, h, sys)` — the console's resolution adapts to the device
rather than being fixed, so nothing should hardcode a screen size.
