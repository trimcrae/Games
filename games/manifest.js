// Every cartridge the console can see. Modules load on demand, so a big game
// costs nothing until someone picks it.

import { ICON_ART } from './explorer/art.js';

export const CARTRIDGES = [
  {
    id: 'explorer',
    title: 'WORLD WALKER',
    subtitle: 'EXPLORE REAL PLACES',
    icon: ICON_ART,
    load: () => import('./explorer/main.js'),
  },
];
