const path = require("path");
const { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain, screen } = require("electron");

// ── Intercept console.log BEFORE requiring core.js ───────────────────────────
const MAX_LOGS  = 200;
const logBuffer = [];
let   mainWin   = null;
let   tray      = null;
let   _showTime = 0;

const _origLog = console.log.bind(console);
console.log = function (...args) {
  _origLog(...args);
  const line = args.map(a => (typeof a === "string" ? a : JSON.stringify(a))).join(" ");
  logBuffer.push(line);
  if (logBuffer.length > MAX_LOGS) logBuffer.shift();
  if (mainWin?.webContents && !mainWin.webContents.isDestroyed()) {
    mainWin.webContents.send("log", line);
  }
};

// ── Expose writable config dir to core.js before requiring it ────────────────
process.env.PRESENCE_CONFIG_DIR = app.getPath("userData");

// ── Start core logic ──────────────────────────────────────────────────────────
const core = require("./core.js");

// ── Window ────────────────────────────────────────────────────────────────────
function createWindow() {
  mainWin = new BrowserWindow({
    width:     390,
    height:    340,
    minWidth:  390,
    maxWidth:  390,
    minHeight: 340,
    maxHeight: 340,
    frame:     false,
    resizable: false,
    show:      false,
    skipTaskbar: true,
    alwaysOnTop: true,
    webPreferences: {
      preload:          path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration:  false,
    },
  });

  mainWin.loadFile(path.join(__dirname, "ui.html"));

  mainWin.webContents.on("did-finish-load", () => {
    if (logBuffer.length > 0) {
      mainWin.webContents.send("logs-batch", logBuffer.slice());
    }
    mainWin.webContents.send("state", core.getState());
  });

  mainWin.on("blur", () => {
    if (Date.now() - _showTime < 1500) return;
    if (!mainWin.webContents.isDevToolsOpened()) {
      mainWin.hide();
    }
  });

  mainWin.once("ready-to-show", () => {
    positionAndShow();
  });
}

// ── Tray ──────────────────────────────────────────────────────────────────────
function createTray() {
  const iconPath = app.isPackaged
    ? path.join(process.resourcesPath, "icon.png")
    : path.join(__dirname, "build", "icon.png");
  const icon = nativeImage.createFromPath(iconPath);

  const tray = new Tray(icon);
  tray.setToolTip("Presence Discord");

  tray.on("click", () => {
    if (!mainWin) return;
    if (mainWin.isVisible() && mainWin.isFocused()) {
      mainWin.hide();
    } else {
      positionAndShow();
    }
  });

  tray.on("right-click", () => {
    const autoStart = app.getLoginItemSettings().openAtLogin;
    tray.popUpContextMenu(
      Menu.buildFromTemplate([
        { label: "Ouvrir",   click: () => positionAndShow() },
        { label: "Relancer", click: () => { core.shutdown(); app.relaunch(); app.quit(); } },
        { type: "separator" },
        {
          label: (autoStart ? "✓ " : "") + "Démarrage automatique",
          click: () => app.setLoginItemSettings({ openAtLogin: !autoStart }),
        },
        { type: "separator" },
        { label: "Quitter",  click: () => { app.quit(); } },
      ])
    );
  });

  return tray;
}

function positionAndShow() {
  if (!mainWin) return;
  const trayBounds = tray?.getBounds();
  const { workArea } = trayBounds
    ? screen.getDisplayNearestPoint({ x: trayBounds.x, y: trayBounds.y })
    : screen.getPrimaryDisplay();
  const { width: ww, height: wh } = mainWin.getBounds();
  const x = workArea.x + workArea.width  - ww - 8;
  const y = workArea.y + workArea.height - wh - 8;
  mainWin.setPosition(x, y);
  _showTime = Date.now();
  mainWin.show();
  mainWin.focus();
  mainWin.moveTop();
  mainWin.webContents.send("state", core.getState());
}

// ── Single instance lock ──────────────────────────────────────────────────────
if (!app.requestSingleInstanceLock()) {
  app.quit();
}

app.on("second-instance", () => {
  if (mainWin) positionAndShow();
});

// ── App lifecycle ─────────────────────────────────────────────────────────────
app.whenReady().then(() => {
  app.setAppUserModelId("com.presence-discord");
  createWindow();
  tray = createTray();
  // ── IPC ─────────────────────────────────────────────────────────────────────
  ipcMain.on("close-window",    () => mainWin?.hide());
  ipcMain.on("minimize-window", () => mainWin?.minimize());
});

app.on("window-all-closed", e => e.preventDefault());

// ── State polling ─────────────────────────────────────────────────────────────
setInterval(() => {
  const state = core.getState();
  if (mainWin?.isVisible()) mainWin.webContents.send("state", state);
}, 1000);

app.on("before-quit", () => {
  core.shutdown();
});
