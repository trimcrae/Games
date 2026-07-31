// Boot the handheld.

import { Handheld } from './engine/scene.js';
import { BootScene, LauncherScene } from './engine/system.js';
import { buildShell } from './engine/shell.js';
import { CARTRIDGES } from './games/manifest.js';

const shell = buildShell(document.getElementById('app'), { title: 'HANDHELD' });
const sys = new Handheld({ canvas: shell.canvas, width: 160, height: 144 });
shell.bind(sys);

sys.push(new BootScene(() => new LauncherScene(CARTRIDGES)));
sys.start();

// Handy for debugging from the console; harmless in production.
globalThis.handheld = sys;
