// Map extract definitions. Each region is one Overpass query, fetched by CI
// (tools/fetch-osm.mjs) and committed to data/osm/<id>.json.
//
// bbox is [south, west, north, east] in degrees, matching Overpass's own order.

/** Everything walkable on a campus matters, so campuses keep footways. */
const CAMPUS_HIGHWAYS =
  '^(motorway|trunk|primary|secondary|tertiary|residential|unclassified|living_street|service|pedestrian|footway|path|cycleway|steps|track|corridor)$';

/** A whole town is too much detail; keep the road skeleton only. */
const TOWN_HIGHWAYS = '^(motorway|motorway_link|trunk|trunk_link|primary|primary_link|secondary|secondary_link|tertiary|tertiary_link|residential|unclassified)$';

export const REGIONS = {
  stanford: {
    name: 'Stanford University',
    bbox: [37.42, -122.18, 37.437, -122.159],
    highwayRegex: CAMPUS_HIGHWAYS,
    buildings: ['way["building"]', 'relation["building"]'],
    simplifyM: 2,
    minBuildingArea: 60,
    minAreaFeature: 150,
  },
  rit: {
    name: 'Rochester Institute of Technology',
    bbox: [43.077, -77.691, 43.0925, -77.668],
    highwayRegex: CAMPUS_HIGHWAYS,
    buildings: ['way["building"]', 'relation["building"]'],
    simplifyM: 2,
    minBuildingArea: 60,
    minAreaFeature: 150,
  },
  greece: {
    name: 'Greece, New York',
    bbox: [43.19, -77.75, 43.32, -77.64],
    highwayRegex: TOWN_HIGHWAYS,
    // A town has tens of thousands of houses; keep the ones that read as landmarks.
    buildings: [
      'way["building"]["name"]',
      'relation["building"]["name"]',
      'way["building"~"^(retail|commercial|industrial|warehouse|school|university|college|civic|public|government|church|cathedral|chapel|hospital|stadium|sports_centre|supermarket|hotel|train_station)$"]',
    ],
    simplifyM: 8,
    minBuildingArea: 400,
    minAreaFeature: 4000,
  },
};

/** Build the Overpass QL query for a region. */
export function buildQuery(region, timeout = 540) {
  const bbox = region.bbox.join(',');
  const parts = [
    ...region.buildings.map((b) => `${b}(${bbox});`),
    `way["highway"~"${region.highwayRegex}"](${bbox});`,
    `way["railway"~"^(rail|light_rail|tram)$"](${bbox});`,
    `way["natural"~"^(water|wood|scrub|beach|sand|wetland|grassland)$"](${bbox});`,
    `relation["natural"~"^(water|wood|wetland)$"](${bbox});`,
    `way["water"](${bbox});`,
    `way["waterway"~"^(river|canal|stream)$"](${bbox});`,
    `way["landuse"~"^(grass|forest|meadow|grassland|recreation_ground|village_green|cemetery|farmland|orchard|reservoir|basin)$"](${bbox});`,
    `relation["landuse"~"^(forest|grass|recreation_ground|cemetery)$"](${bbox});`,
    `way["leisure"~"^(park|garden|pitch|track|stadium|common|nature_reserve|golf_course)$"](${bbox});`,
    `relation["leisure"~"^(park|nature_reserve|golf_course)$"](${bbox});`,
    `way["amenity"="parking"](${bbox});`,
    `way["barrier"~"^(hedge|fence|wall)$"](${bbox});`,
    `node["tourism"~"^(artwork|museum|attraction|viewpoint)$"](${bbox});`,
    `node["historic"](${bbox});`,
    `node["amenity"="fountain"](${bbox});`,
    `node["man_made"~"^(tower|lighthouse)$"](${bbox});`,
  ];
  return `[out:json][timeout:${timeout}];\n(\n  ${parts.join('\n  ')}\n);\nout geom;`;
}
