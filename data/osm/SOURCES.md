# Map data sources

Geometry in this directory is derived from **OpenStreetMap**, © OpenStreetMap
contributors, available under the [Open Database License](https://www.openstreetmap.org/copyright)
(ODbL 1.0). Extracts were downloaded from the Overpass API and reduced to the
feature classes the game renders (see `engine/osm.js`).

Regenerate with the `fetch-osm` workflow, or locally with
`node tools/fetch-osm.mjs [region...]`.

| Region | Name | bbox (S,W,N,E) | Fetched | Features |
| --- | --- | --- | --- | --- |
| `stanford` | Stanford University | 37.42, -122.18, 37.437, -122.159 | 2026-07-31 | 3443 |
| `rit` | Rochester Institute of Technology | 43.077, -77.691, 43.0925, -77.668 | 2026-07-31 | 1781 |
| `greece` | Greece, New York | 43.19, -77.75, 43.32, -77.64 | 2026-07-31 | 3095 |
