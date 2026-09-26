const { app, BrowserWindow } = require('electron');
const path = require('path');
const { fork } = require('child_process');
const crypto = require('crypto');

const DAEMON_PORT = 4317;
// Fresh secret per launch, handed to the daemon via env and to the page via the URL fragment.
const TOKEN = crypto.randomBytes(32).toString('hex');

let win;
let daemonProcess;

function startDaemon() {
  return new Promise((resolve) => {
    daemonProcess = fork(path.join(__dirname, 'daemon.js'), [], {
      env: { ...process.env, CLAUDE_GUI_DAEMON_PORT: String(DAEMON_PORT), CLAUDE_GUI_TOKEN: TOKEN },
      stdio: ['ignore', 'pipe', 'inherit', 'ipc'],
    });
    daemonProcess.stdout.on('data', (chunk) => {
      if (chunk.toString().includes('listening')) resolve();
    });
  });
}

async function createWindow() {
  await startDaemon();

  win = new BrowserWindow({
    width: 900,
    height: 600,
    title: 'Claude',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  win.loadFile('index.html', { hash: `token=${TOKEN}` });

  win.on('closed', () => {
    win = null;
  });
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (daemonProcess) daemonProcess.kill();
  app.quit();
});

app.on('before-quit', () => {
  if (daemonProcess) daemonProcess.kill();
});
