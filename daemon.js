// Standalone session daemon: owns the pty, speaks WebSocket. No Electron dependency,
// so this same process (or a remote copy of it) can serve either the Electron shell
// or a plain browser tab later.
const http = require('http');
const path = require('path');
const crypto = require('crypto');
const { pathToFileURL } = require('url');
const { WebSocketServer } = require('ws');
const pty = require('node-pty');

const PORT = process.env.PLAUDE_DAEMON_PORT || 4317;

// Which program to run in the pty. Nothing downstream cares — any interactive terminal
// program works. Set only by whoever starts the daemon, never by a connecting client.
const COMMAND = process.env.PLAUDE_COMMAND || 'claude';

// Shared secret for this run. Electron passes one in; when started by hand we mint our own.
// Anything that can reach this port gets a shell, so every connection must present it.
const TOKEN = process.env.PLAUDE_TOKEN || crypto.randomBytes(32).toString('hex');

// Browsers stamp every WebSocket handshake with the page's Origin and scripts can't forge it.
// Our page is loaded from disk: Electron reports 'file://', Chrome reports 'null'.
// 'null' alone would also admit sandboxed iframes on any site, which is why the token is required too.
const ALLOWED_ORIGINS = new Set(['file://', 'null']);

function tokenMatches(candidate) {
  const a = Buffer.from(candidate || '');
  const b = Buffer.from(TOKEN);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

const server = http.createServer();
const wss = new WebSocketServer({
  server,
  // Runs during the HTTP upgrade handshake, before any pty is spawned.
  verifyClient: ({ origin, req }, done) => {
    if (!ALLOWED_ORIGINS.has(origin)) {
      console.error(`rejected connection: origin ${JSON.stringify(origin)} not allowed`);
      return done(false, 403, 'Forbidden origin');
    }
    const token = new URL(req.url, 'http://localhost').searchParams.get('token');
    if (!tokenMatches(token)) {
      console.error('rejected connection: missing or invalid token');
      return done(false, 401, 'Bad token');
    }
    done(true);
  },
});

wss.on('connection', (ws) => {
  const shell = process.platform === 'win32' ? 'powershell.exe' : (process.env.SHELL || '/bin/zsh');
  const args = process.platform === 'win32' ? [] : ['-lc', COMMAND];

  const ptyProcess = pty.spawn(shell, args, {
    name: 'xterm-256color',
    cols: 80,
    rows: 30,
    cwd: process.env.HOME,
    env: process.env,
  });

  ptyProcess.onData((data) => {
    if (ws.readyState === ws.OPEN) ws.send(data);
  });

  ptyProcess.onExit(() => {
    if (ws.readyState === ws.OPEN) ws.close();
  });

  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }
    if (msg.t === 'i') {
      ptyProcess.write(msg.d);
    } else if (msg.t === 'r') {
      ptyProcess.resize(msg.cols, msg.rows);
    }
  });

  ws.on('close', () => {
    ptyProcess.kill();
  });
});

server.listen(PORT, '127.0.0.1', () => {
  // Signal readiness on stdout for whoever spawned this (e.g. Electron main process).
  console.log(`plaude-daemon listening on ${PORT} (running: ${COMMAND})`);
  if (!process.env.PLAUDE_TOKEN) {
    // Started by hand (no Electron): print the one URL that can connect. The token rides in the
    // #fragment, which browsers never send over the network or in Referer headers.
    const page = pathToFileURL(path.join(__dirname, 'index.html'));
    console.log(`open: ${page.href}#token=${TOKEN}`);
  }
});
