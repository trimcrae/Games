// Boot the handheld.

import { Handheld } from './engine/scene.js';
import { BootScene, LauncherScene } from './engine/system.js';
import { buildShell } from './engine/shell.js';
import { CARTRIDGES } from './games/manifest.js';

// The shell measures the screen area and picks the framebuffer size that fills
// it at a whole-number pixel scale, so the console is built to fit the device
// rather than the other way round.
const shell = buildShell(document.getElementById('app'), { title: 'HANDHELD' });
const sys = new Handheld({ canvas: shell.canvas, width: shell.size.width, height: shell.size.height });
shell.bind(sys);

// Rotating the phone or resizing the window can change the derived resolution.
// `resize` is optional on the console; without it the shell keeps the boot
// resolution and only re-fits the scale.
shell.onResize(({ width, height }) => sys.resize?.(width, height));

sys.push(new BootScene(() => new LauncherScene(CARTRIDGES)));
sys.start();

// Handy for debugging from the console; harmless in production.
globalThis.handheld = sys;
