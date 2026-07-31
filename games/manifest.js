// Every cartridge the console can see. Modules load on demand, so a big game
// costs nothing until someone picks it.

import { ICON_ART as EXPLORER_ICON } from './explorer/art.js';
import { ICON_ART as COURIER_ICON } from './courier/sprites.js';
import { ICON_ART as BEACON_ICON } from './beacon/art.js';

export const CARTRIDGES = [
  {
    id: 'explorer',
    title: 'WORLD WALKER',
    subtitle: 'EXPLORE REAL PLACES',
    icon: EXPLORER_ICON,
    load: () => import('./explorer/main.js'),
  },
  {
    id: 'courier',
    title: 'CAMPUS COURIER',
    subtitle: 'BEAT THE CLOCK',
    icon: COURIER_ICON,
    load: () => import('./courier/main.js'),
  },
  {
    id: 'beacon',
    title: 'BEACON',
    subtitle: 'KEEP THEM OFF THE ROCKS',
    icon: BEACON_ICON,
    load: () => import('./beacon/main.js'),
  },
];
