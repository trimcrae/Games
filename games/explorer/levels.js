import { SLOT } from '../../engine/gfx.js';

// The three explorable places.
//
// Geometry comes from the committed OpenStreetMap extracts in data/osm; every
// coordinate below was read out of that extract, so landmarks sit where they
// really are. `photo` names a panel in data/photos (a pixelized freely-licensed
// photograph); `art` names a hand-drawn fallback in ./art.js.

export const LEVELS = [
  {
    id: 'stanford',
    name: 'STANFORD',
    subtitle: 'Palo Alto, California',
    data: 'data/osm/stanford.json',
    metersPerTile: 6,
    buildingSlot: SLOT.WALL,
    bbox: [37.4235, -122.1775, 37.4375, -122.1595],
    start: [37.42832, -122.16968],
    walkSpeed: 54,
    // Stanford runs on bicycles: racks outside every door, and a roundabout on
    // Escondido Mall built purely so that bikes stop colliding with each other.
    // The first rack is a few steps from where you spawn.
    racks: [
      { id: 'lasuen', name: 'LASUEN MALL RACKS', at: [37.42844, -122.16976] },
      { id: 'bike-circle', name: 'THE BIKE CIRCLE', at: [37.426123, -122.169057] },
      { id: 'green-library', name: 'GREEN LIBRARY RACKS', at: [37.42703, -122.16813] },
      { id: 'white-plaza', name: 'WHITE PLAZA RACKS', at: [37.42491, -122.17003] },
      { id: 'eng-quad', name: 'ENGINEERING RACKS', at: [37.42795, -122.1741] },
      { id: 'oval', name: 'OVAL RACKS', at: [37.43012, -122.16921] },
    ],
    pois: [
      {
        id: 'hoover-tower',
        name: 'HOOVER TOWER',
        at: [37.42772, -122.16698],
        photo: 'hoover-tower',
        art: 'hooverTower',
        text: [
          'A 285-foot bell tower finished in 1941, for the university\'s 50th year.',
          'It holds the Hoover Institution archives and a 48-bell carillon. An elevator runs to an observation deck with a view clear to the bay.',
        ],
      },
      {
        id: 'memorial-church',
        name: 'MEMORIAL CHURCH',
        at: [37.42688, -122.17017],
        photo: 'memorial-church',
        art: 'church',
        text: [
          'Jane Stanford built this church in memory of her husband Leland. It opened in 1903 at the heart of the Main Quad.',
          'Its mosaic front is made of Venetian glass. The 1906 earthquake brought down the spire; the 1989 quake closed it for years more.',
        ],
      },
      {
        id: 'main-quad',
        name: 'THE MAIN QUAD',
        at: [37.42714, -122.17037],
        photo: 'main-quad',
        art: 'quad',
        text: [
          'The original 1891 campus: buff sandstone arcades under red tile roofs, arranged around an open court.',
          'Frederick Law Olmsted, who laid out Central Park, helped plan the grounds. Classes still meet behind these arches.',
        ],
      },
      {
        id: 'the-oval',
        name: 'THE OVAL',
        at: [37.43007, -122.1694],
        photo: 'stanford-oval',
        art: 'oval',
        text: [
          'A ring of lawn at the head of Palm Drive, the long approach lined with Canary Island palms.',
          'Stand at the centre and the Main Quad lines up dead ahead. It is where the campus poses for photographs.',
        ],
      },
      {
        id: 'cantor',
        name: 'CANTOR ARTS CENTER',
        at: [37.43298, -122.17092],
        photo: 'cantor-arts',
        art: 'museum',
        text: [
          'The university art museum, opened in 1894 as the Leland Stanford Junior Museum.',
          'It was wrecked by the 1906 earthquake and only fully reopened in 1999. Admission is free.',
        ],
      },
      {
        id: 'rodin',
        name: 'RODIN GARDEN',
        at: [37.43242, -122.17104],
        photo: 'rodin-garden',
        art: 'rodin',
        text: [
          'An outdoor garden of bronzes by Auguste Rodin, among the largest collections of his work anywhere.',
          'The Gates of Hell stands at its edge, crowded with figures. The Burghers of Calais are a short walk away.',
        ],
      },
      {
        id: 'green-library',
        name: 'GREEN LIBRARY',
        at: [37.4269, -122.16757],
        photo: 'green-library',
        art: 'library',
        text: [
          'The main library, just east of the Quad. The older Bing Wing dates from 1919; the Meyer-era addition wraps around it.',
          'Special Collections keeps the university archives here, along with rare books and manuscripts.',
        ],
      },
      {
        id: 'huang',
        name: 'HUANG CENTER',
        at: [37.42799, -122.1743],
        photo: 'engineering-quad',
        art: 'tower',
        text: [
          'The Jen-Hsun Huang Engineering Center, opened in 2010, the anchor of the Science and Engineering Quad.',
          'It is the newest of the university\'s quads, built a century after the first one and deliberately echoing its arcades.',
        ],
      },
      {
        id: 'stadium',
        name: 'STANFORD STADIUM',
        at: [37.43392, -122.16188],
        photo: 'stanford-stadium',
        art: 'stadium',
        text: [
          'Home of the football team since 1921. The old bowl was demolished and rebuilt in a single off-season in 2006.',
          'The earlier stadium hosted Super Bowl XIX, 1984 Olympic soccer, and matches of the 1994 World Cup.',
        ],
      },
    ],
  },

  {
    id: 'rit',
    name: 'R I T',
    subtitle: 'Henrietta, New York',
    data: 'data/osm/rit.json',
    metersPerTile: 6,
    buildingSlot: SLOT.BRICK,
    bbox: [43.0795, -77.6865, 43.0905, -77.6675],
    start: [43.08432, -77.67703],
    walkSpeed: 54,
    // RIT is compact enough to walk, so the racks sit where a bike actually
    // saves you something: the ends of the quarter mile, and the campus bike
    // path out to the east side.
    racks: [
      { id: 'quarter-mile', name: 'QUARTER MILE RACKS', at: [43.08435, -77.67696] },
      { id: 'global-village', name: 'GLOBAL VILLAGE RACKS', at: [43.08283, -77.68073] },
      { id: 'winding-way', name: 'WINDING WAY PATH', at: [43.084337, -77.670552] },
    ],
    pois: [
      {
        id: 'quarter-mile',
        name: 'THE QUARTER MILE',
        at: [43.084629, -77.67436],
        photo: 'rit-quarter-mile',
        art: 'quad',
        text: [
          'The brick spine of the campus, running about a quarter of a mile end to end. Everything else hangs off it.',
          'Albert Paley\'s Sentinel, seventy feet of curling weathered steel, stands at its northern end, raised in 2003.',
        ],
      },
      {
        id: 'eastman-quad',
        name: 'EASTMAN QUAD',
        at: [43.08469, -77.67628],
        photo: 'rit-campus',
        art: 'quad',
        text: [
          'One of the open brick quads at the centre of campus, named with George Eastman Hall beside it.',
          'RIT moved here from downtown Rochester in 1968 and the whole campus went up at once, which is why every wall is the same brick.',
        ],
      },
      {
        id: 'wallace',
        name: 'WALLACE LIBRARY',
        at: [43.08401, -77.67641],
        photo: 'rit-library',
        art: 'library',
        text: [
          'The main campus library, on the quarter mile.',
          'Its lower floors hold The Construct, a maker space of 3D printers and laser cutters open to any student.',
        ],
      },
      {
        id: 'field-house',
        name: 'GORDON FIELD HOUSE',
        at: [43.08524, -77.67216],
        photo: 'rit-field-house',
        art: 'arena',
        text: [
          'A domed field house and activities centre opened in 2004.',
          'It swallows an arena, a pool and a running track, and doubles as the hall for commencement.',
        ],
      },
      {
        id: 'polisseni',
        name: 'POLISSENI CENTER',
        at: [43.08255, -77.67474],
        photo: 'rit-polisseni-ext',
        art: 'arena',
        text: [
          'The hockey arena, opened in 2014, seating a little over four thousand.',
          'Both the men\'s and women\'s teams play here, and the corner student section is loud enough to be a nuisance to visitors.',
        ],
      },
      {
        id: 'golisano',
        name: 'GOLISANO HALL',
        at: [43.08425, -77.67983],
        photo: 'rit-golisano',
        art: 'tower',
        text: [
          'Home of the Golisano College of Computing and Information Sciences, named for a gift from B. Thomas Golisano in 2001.',
          'Labs here run everything from games to cybersecurity; RIT teams have taken the national collegiate cyber defence title more than once.',
        ],
      },
      {
        id: 'ntid',
        name: 'N T I D',
        at: [43.08706, -77.66846],
        photo: 'rit-ntid',
        art: 'tower',
        text: [
          'The National Technical Institute for the Deaf, established by Congress in 1965 with RIT chosen to host it.',
          'It is one of RIT\'s colleges, and it is why this campus has one of the largest deaf and hard-of-hearing student populations anywhere.',
        ],
      },
      {
        id: 'tiger',
        name: 'TIGER STATUE',
        at: [43.084208, -77.675591],
        photo: 'rit-tiger',
        art: 'tiger',
        text: [
          'The bronze tiger on the quarter mile, RIT\'s mascot since the 1950s.',
          'Every prospective student on a campus tour is photographed beside it, which is why its nose is polished bright.',
        ],
      },
      {
        id: 'global-village',
        name: 'GLOBAL VILLAGE',
        at: [43.08292, -77.68085],
        photo: 'rit-global-village',
        art: 'plazaScene',
        text: [
          'A residential plaza on the west side of campus, ringed by shops and places to eat.',
          'It is where the campus goes when it wants to be outdoors, which in Rochester is a narrow window.',
        ],
      },
    ],
  },

  {
    id: 'greece',
    name: 'GREECE',
    subtitle: 'Monroe County, New York',
    data: 'data/osm/greece.json',
    metersPerTile: 12,
    bbox: [43.195, -77.745, 43.322, -77.645],
    start: [43.2585, -77.698],
    walkSpeed: 62,
    // Greece is 8 by 14 km and there is no campus to walk across, so the racks
    // are strung along the places you would actually ride between: the town
    // hall, the mall, the lake shore, and the Erie Canal towpath where it
    // crosses Elmgrove Road at Greece Canal Park.
    racks: [
      { id: 'town-hall', name: 'TOWN HALL RACK', at: [43.25828, -77.69863] },
      { id: 'greece-ridge', name: 'GREECE RIDGE RACK', at: [43.20532, -77.69211] },
      { id: 'long-pond', name: 'LONG POND RACK', at: [43.28628, -77.69093] },
      { id: 'canal-towpath', name: 'CANAL TOWPATH', at: [43.196025, -77.732162] },
    ],
    pois: [
      {
        id: 'greece-ridge',
        name: 'GREECE RIDGE',
        at: [43.20565, -77.69238],
        photo: 'greece-ridge',
        art: 'mall',
        text: [
          'The Mall at Greece Ridge, one of the largest shopping centres in New York State.',
          'It exists because two rival malls sat across the road from one another; in the 1990s they were joined into a single mile-long building.',
        ],
      },
      {
        id: 'long-pond',
        name: 'LONG POND',
        at: [43.28672, -77.69137],
        photo: 'long-pond',
        art: 'pond',
        text: [
          'One of a chain of ponds strung along the lake shore, held back from Lake Ontario by bars of sand.',
          'They are drowned creek mouths: the lake rose after the glaciers left and flooded the valleys behind the beach.',
        ],
      },
      {
        id: 'beatty-point',
        name: 'BEATTY POINT',
        at: [43.27541, -77.68562],
        photo: 'braddock-bay',
        art: 'bay',
        text: [
          'A low point of land reaching into Long Pond, at the north end of the town.',
          'This is the stretch of shoreline that raptors follow every spring rather than cross the open lake, and the counts run into the tens of thousands.',
        ],
      },
      {
        id: 'town-hall',
        name: 'GREECE TOWN HALL',
        at: [43.25846, -77.69793],
        photo: 'greece-town-hall',
        art: 'townhall',
        text: [
          'The seat of the Town of Greece, a suburb of about a hundred thousand people on Rochester\'s north-west edge.',
          'The town took its name in 1822, during the Greek war of independence, when classical names were in fashion here.',
        ],
      },
    ],
  },
];

export const LEVEL_BY_ID = Object.fromEntries(LEVELS.map((l) => [l.id, l]));

// --- fast travel -----------------------------------------------------------
//
// The three places are real and unevenly spaced. RIT and Greece are both in
// Monroe County, about 25 km apart and joined by 390, so the link between them
// is a drive. Stanford is 4,000 km away in California, so the only honest link
// is a flight, and both New York maps therefore need an air hub of their own.
// Greater Rochester International (ROC) is the airport at the New York end: it
// sits between the two, just south of the town of Greece and just north of RIT.
//
// Every `at` and every `arriveAt` below was read back out of the compiled
// tilemap and lands on a walkable road, path or parking tile inside the level's
// bbox. Move one and it needs re-checking, or the hub becomes unreachable.

export const TRAVEL_HUBS = {
  stanford: [
    {
      id: 'galvez-coach',
      kind: 'airport',
      art: 'airportHub',
      name: 'GALVEZ COACH STOP',
      at: [37.43381, -122.16344],
      blurb:
        'The coach kerb on Galvez Street, below Stanford Stadium. Airport runs leave from here: south down 101 to San Jose, or north up the peninsula to San Francisco.',
      routes: [
        {
          to: 'rit',
          kind: 'flight',
          label: 'SJC -> ROC',
          minutes: 380,
          arriveAt: [43.08375, -77.67512],
        },
        {
          to: 'greece',
          kind: 'flight',
          label: 'SFO -> ROC',
          minutes: 355,
          arriveAt: [43.25893, -77.69951],
        },
      ],
    },
  ],

  rit: [
    {
      id: 'transit-plaza',
      kind: 'airport',
      art: 'airportHub',
      name: 'RIT TRANSIT PLAZA',
      at: [43.08343, -77.67512],
      blurb:
        'The bus loop below the Student Alumni Union, where the airport shuttle waits at the start and end of every term. ROC is fifteen minutes north up 390.',
      routes: [
        {
          to: 'stanford',
          kind: 'flight',
          label: 'ROC -> SFO',
          minutes: 365,
          arriveAt: [37.43414, -122.16338],
        },
      ],
    },
    {
      id: 'lomb-gate',
      kind: 'highway',
      art: 'highwayHub',
      name: 'LOMB MEMORIAL DR',
      at: [43.08826, -77.67431],
      blurb:
        'The north gate of campus. Lomb Memorial Drive runs out to Jefferson Road, NY-252, and from there it is one junction east to I-390.',
      routes: [
        {
          to: 'greece',
          kind: 'drive',
          label: 'I-390 N',
          minutes: 28,
          signs: ['I-390 N', 'RIDGE RD EXIT'],
          arriveAt: [43.20445, -77.67672],
        },
      ],
    },
  ],

  greece: [
    {
      id: 'ridge-interchange',
      kind: 'highway',
      art: 'highwayHub',
      name: 'RIDGE RD INTERCHANGE',
      at: [43.2037, -77.67672],
      blurb:
        'Where 390 crosses Ridge Road, NY-104, at the south-east corner of the town. Southbound it runs down the west side of Rochester to Henrietta.',
      routes: [
        {
          to: 'rit',
          kind: 'drive',
          label: 'I-390 S',
          minutes: 26,
          signs: ['I-390 S', 'JEFFERSON RD EXIT'],
          arriveAt: [43.08847, -77.67401],
        },
      ],
    },
    {
      id: 'tofany-coach',
      kind: 'airport',
      art: 'airportHub',
      name: 'TOWN HALL PARK+RIDE',
      at: [43.25904, -77.69863],
      blurb:
        'The lot on Vince Tofany Boulevard, beside the town hall. Leave the car here and the airport coach takes you the eight miles south to ROC.',
      routes: [
        {
          to: 'stanford',
          kind: 'flight',
          label: 'ROC -> SFO',
          minutes: 375,
          arriveAt: [37.43414, -122.16338],
        },
      ],
    },
  ],
};
