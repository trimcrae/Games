// Candidate source photographs for point-of-interest panels.
//
// Each entry names a Wikipedia article (its lead image is used) and/or a
// Commons search query as a fallback. Only freely-licensed images are accepted;
// tools/fetch-photos.mjs rejects anything else and reports it as missing so the
// landmark gets hand-drawn art instead.
//
//   id       output name in data/photos/<id>.json
//   wiki     English Wikipedia article title, lead image is preferred
//   search   Commons full-text search used if the article has no usable image
//            (up to three queries; later ones only run if earlier ones came up short)
//   must     term every Commons search hit has to name, on top of the usual
//            relevance guard. Use it where a generic query would otherwise
//            accept the right kind of thing in the wrong place — a historical
//            society museum in Tonawanda is not the one in Greece. Not applied
//            to `wiki` lead images, which are already on topic.
//   gravity  crop anchor for the panel (ImageMagick -gravity, default center)
//   tune     per-image tone controls passed to tools/pixelize.mjs

export const PANEL = { w: 176, h: 120 };

export const PHOTOS = [
  // --- Stanford ------------------------------------------------------------
  { id: 'hoover-tower', wiki: 'Hoover Tower', search: 'Hoover Tower Stanford', gravity: 'north' },
  { id: 'memorial-church', wiki: 'Stanford Memorial Church', search: 'Stanford Memorial Church facade', gravity: 'north' },
  { id: 'main-quad', search: 'Stanford Main Quadrangle arcade' },
  { id: 'stanford-oval', search: 'Stanford Oval panorama' },
  { id: 'green-library', wiki: 'Cecil H. Green Library', search: 'Green Library Stanford' },
  { id: 'cantor-arts', wiki: 'Cantor Arts Center', search: 'Cantor Arts Center Stanford' },
  { id: 'rodin-garden', search: 'Rodin Sculpture Garden Stanford Gates of Hell' },
  { id: 'stanford-stadium', wiki: 'Stanford Stadium', search: 'Stanford Stadium' },
  { id: 'stanford-dish', wiki: 'Stanford Dish', search: ['Stanford Dish radio telescope', 'Stanford Dish antenna'] },
  { id: 'white-plaza', search: ['White Plaza Stanford', 'Stanford bookstore plaza'] },
  { id: 'engineering-quad', search: ['Huang Engineering Center Stanford', 'Stanford engineering quad'] },

  // --- RIT -----------------------------------------------------------------
  { id: 'rit-campus', wiki: 'Rochester Institute of Technology', search: ['Rochester Institute of Technology campus', 'RIT campus Henrietta New York', 'RIT building Rochester Institute of Technology'] },
  // The sculpture is always credited to Albert Paley, so require his name: a
  // bare "sculpture" hit is as likely to be somebody else's work in a park.
  { id: 'rit-sentinel', search: ['Albert Paley Sentinel sculpture', 'Sentinel sculpture Rochester Institute of Technology', 'Albert Paley Sentinel RIT'], must: 'paley' },
  { id: 'rit-sau', search: ['RIT Student Alumni Union', 'Student Alumni Union Rochester Institute of Technology', 'RIT building Student Alumni Union'], must: 'union' },
  { id: 'rit-golisano', search: ['Golisano College computing RIT', 'Golisano Hall RIT'] },
  { id: 'rit-tiger', search: ['RIT Tiger statue', 'Tiger statue Rochester Institute'] },
  { id: 'rit-quarter-mile', search: ['RIT Quarter Mile', 'RIT campus quad brick'] },
  { id: 'rit-polisseni', wiki: 'Gene Polisseni Center', search: 'Gene Polisseni Center' },
  { id: 'rit-field-house', search: 'Gordon Field House RIT' },
  { id: 'rit-library', search: 'Wallace Library Rochester Institute of Technology' },
  { id: 'rit-global-village', search: 'Global Village Rochester Institute of Technology' },
  { id: 'rit-ntid', wiki: 'National Technical Institute for the Deaf', search: ['NTID Rochester Institute', 'National Technical Institute Deaf building'] },
  { id: 'rit-polisseni-ext', search: ['Polisseni Center exterior', 'Gene Polisseni'] },

  // --- Greece, NY ----------------------------------------------------------
  { id: 'greece-ridge', wiki: 'The Mall at Greece Ridge', search: 'Mall at Greece Ridge' },
  { id: 'braddock-bay', wiki: 'Braddock Bay', search: 'Braddock Bay New York' },
  { id: 'long-pond', search: ['Long Pond Greece New York', 'Long Pond Monroe County New York', 'Long Pond Rochester New York'], must: 'pond' },
  { id: 'greece-town-hall', search: ['Greece New York town hall', 'Greece Town Hall Monroe County New York'], must: 'greece' },
  // Without `must` this matched the Tonawanda-Kenmore historical society museum,
  // which is a 90-minute drive from the landmark it was standing in for.
  { id: 'greece-historical', search: ['Greece Historical Society museum', 'Greece Historical Society Rochester New York', 'Greece New York museum'], must: 'greece' },
  { id: 'schallers', wiki: "Schaller's Drive-In", search: ["Schaller's Drive-In Rochester New York", 'Schallers Drive In Rochester', "Schaller's restaurant Greece New York"], must: 'schaller' },
  { id: 'braddock-bay-park', search: ['Braddock Bay Park Greece New York', 'Braddock Bay marina boat launch', 'Braddock Bay Park New York'], must: 'braddock' },
];
