'use strict';
// Dev launcher for Electron v35: places a dev asar at the electron binary's
// resources/app.asar so Electron loads it in production mode (where
// require('electron') correctly returns the built-in API).
const path   = require('path');
const fs     = require('fs');
const os     = require('os');
const { spawn }    = require('child_process');
const { createPackageWithOptions } = require('@electron/asar');

const electronBin = require('electron');  // path to electron.exe
const resourcesDir = path.join(path.dirname(electronBin), 'resources');
const appAsarPath  = path.join(resourcesDir, 'app.asar');
const projectDir   = __dirname;

// Clean up any leftover asar from a previous aborted run
try { fs.unlinkSync(appAsarPath); } catch (_) {}

// Source files to include in the dev asar
const INCLUDE       = ['main.js', 'core.js', 'platforms.js', 'preload.js', 'ui.html', 'build', 'config.json'];
const RUNTIME_MODS  = ['ws'];

(async () => {
  // Build a minimal staging directory
  const stageDir = fs.mkdtempSync(path.join(os.tmpdir(), 'presence-dev-'));
  try {
    for (const name of INCLUDE) {
      const src = path.join(projectDir, name);
      if (fs.existsSync(src)) copyRecursive(src, path.join(stageDir, name));
    }
    const nmDst = path.join(stageDir, 'node_modules');
    fs.mkdirSync(nmDst, { recursive: true });
    for (const mod of RUNTIME_MODS) {
      const src = path.join(projectDir, 'node_modules', mod);
      if (fs.existsSync(src)) copyRecursive(src, path.join(nmDst, mod));
    }
    fs.writeFileSync(path.join(stageDir, 'package.json'), JSON.stringify(
      { name: 'presence-discord-companion', version: '1.0.0', main: 'main.js' }
    ));

    process.stdout.write('Building dev package... ');
    await createPackageWithOptions(stageDir, appAsarPath, {});
    console.log('done.');
  } finally {
    fs.rmSync(stageDir, { recursive: true, force: true });
  }

  // Run electron.exe with no args — it will find resources/app.asar and load
  // it directly in production mode (require('electron') works in that mode).
  const child = spawn(electronBin, [], { stdio: 'inherit' });
  child.on('close', code => {
    try { fs.unlinkSync(appAsarPath); } catch (_) {}
    process.exit(code ?? 0);
  });

  // Clean up on unexpected exit
  const cleanup = () => { try { fs.unlinkSync(appAsarPath); } catch (_) {} };
  process.on('exit', cleanup);
  process.on('SIGINT', () => { cleanup(); process.exit(130); });
})().catch(err => {
  try { fs.unlinkSync(appAsarPath); } catch (_) {}
  console.error('Dev start failed:', err.message);
  process.exit(1);
});

function copyRecursive(src, dst) {
  const stat = fs.statSync(src);
  if (stat.isDirectory()) {
    fs.mkdirSync(dst, { recursive: true });
    for (const entry of fs.readdirSync(src)) {
      copyRecursive(path.join(src, entry), path.join(dst, entry));
    }
  } else {
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.copyFileSync(src, dst);
  }
}
