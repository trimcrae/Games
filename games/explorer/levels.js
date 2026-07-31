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
    bbox: [37.4235, -122.1775, 37.4375, -122.1595],
    start: [37.42832, -122.16968],
    walkSpeed: 54,
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
        photo: 'main-quad',
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
        id: 'stadium',
        name: 'STANFORD STADIUM',
        at: [37.43447, -122.16116],
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
    bbox: [43.0795, -77.6865, 43.0905, -77.6675],
    start: [43.08432, -77.67703],
    walkSpeed: 54,
    pois: [
      {
        id: 'sentinel',
        name: 'THE SENTINEL',
        at: [43.084629, -77.67436],
        art: 'sentinel',
        text: [
          'Albert Paley\'s steel sculpture, raised in 2003 outside the Student Alumni Union.',
          'Seventy feet of curling weathered steel, welded in Rochester. Paley kept a studio in the city for decades.',
        ],
      },
      {
        id: 'infinity-quad',
        name: 'INFINITY QUAD',
        at: [43.08432, -77.67703],
        photo: 'rit-campus',
        art: 'quad',
        text: [
          'One of the open brick quads at the centre of campus, named for the Infinity sculpture standing in it.',
          'RIT moved here from downtown Rochester in 1968, and the whole campus was built at once - which is why every wall is the same brick.',
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
        photo: 'rit-polisseni',
        art: 'arena',
        text: [
          'The hockey arena, opened in 2014, seating a little over four thousand.',
          'Both the men\'s and women\'s teams play here. The corner student section is loud enough to be a nuisance to visitors.',
        ],
      },
      {
        id: 'golisano',
        name: 'GOLISANO HALL',
        at: [43.08425, -77.67983],
        photo: 'rit-global-village',
        art: 'tower',
        text: [
          'Home of the Golisano College of Computing and Information Sciences, named for a 2001 gift from B. Thomas Golisano.',
          'Labs here run everything from games to cybersecurity - RIT teams have won the national collegiate cyber defense title more than once.',
        ],
      },
      {
        id: 'tiger',
        name: 'TIGER STATUE',
        at: [43.084208, -77.675591],
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
    pois: [
      {
        id: 'braddock-bay',
        name: 'BRADDOCK BAY',
        at: [43.31341, -77.71329],
        photo: 'braddock-bay',
        art: 'bay',
        text: [
          'A shallow bay off Lake Ontario, cut off from it by a barrier beach.',
          'Every spring, hawks and eagles funnel along the shoreline rather than cross the open lake, and the counts here run into the tens of thousands.',
        ],
      },
      {
        id: 'greece-ridge',
        name: 'GREECE RIDGE',
        at: [43.20565, -77.69238],
        photo: 'greece-ridge',
        art: 'mall',
        text: [
          'The Mall at Greece Ridge, one of the largest shopping centres in New York State.',
          'It exists because two rival malls sat across the road from each other; in the 1990s they were joined into a single mile-long building.',
        ],
      },
      {
        id: 'long-pond',
        name: 'LONG POND',
        at: [43.28864, -77.69395],
        photo: 'long-pond',
        art: 'pond',
        text: [
          'One of a chain of ponds strung along the lake shore, held back from Lake Ontario by sand bars.',
          'They are drowned creek mouths - the lake rose after the glaciers left and flooded the valleys.',
        ],
      },
      {
        id: 'canal-park',
        name: 'GREECE CANAL PARK',
        at: [43.19853, -77.74362],
        art: 'canal',
        text: [
          'A town park in the far south of Greece, on the Erie Canal.',
          'The towpath alongside is now a trail; the canal here has been carrying boats since the 1820s.',
        ],
      },
      {
        id: 'town-hall',
        name: 'GREECE TOWN HALL',
        at: [43.25846, -77.69793],
        art: 'townhall',
        text: [
          'The seat of the Town of Greece, a suburb of about a hundred thousand people on Rochester\'s north-west edge.',
          'The town took its name in 1822, during the Greek war of independence, when classical names were in fashion here.',
        ],
      },
      {
        id: 'historical-society',
        name: 'HISTORICAL SOCIETY',
        at: [43.25975, -77.69722],
        art: 'museum',
        text: [
          'The Greece Historical Society museum, next to the town hall campus.',
          'Its rooms cover the orchards and canal trade that came before the subdivisions, and the lake resorts that once lined the shore.',
        ],
      },
      {
        id: 'schallers',
        name: 'SCHALLER\'S',
        at: [43.27863, -77.65239],
        art: 'diner',
        text: [
          'A drive-in on Edgemere Drive, near the lake, serving Rochester\'s own plate of hots, burgers and fries.',
          'Places like this are why the stretch by the water empties out in winter and fills again the week it warms up.',
        ],
      },
      {
        id: 'athena',
        name: 'GREECE ATHENA',
        at: [43.24414, -77.69314],
        art: 'school',
        text: [
          'One of the town\'s high schools. Greece names its schools for classical places: Athena, Arcadia, Olympia, Odyssey.',
          'The district is among the largest in the county - a legacy of the post-war building boom that turned farmland into streets.',
        ],
      },
    ],
  },
];

export const LEVEL_BY_ID = Object.fromEntries(LEVELS.map((l) => [l.id, l]));
