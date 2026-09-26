// Standalone session daemon: owns the pty, speaks WebSocket. No Electron dependency,
// so this same process (or a remote copy of it) can serve either the Electron shell
// or a plain browser tab later.
const http = require('http');
const { WebSocketServer } = require('ws');
const pty = require('node-pty');

const PORT = process.env.CLAUDE_GUI_DAEMON_PORT || 4317;

const server = http.createServer();
const wss = new WebSocketServer({ server });

wss.on('connection', (ws) => {
  const shell = process.platform === 'win32' ? 'powershell.exe' : (process.env.SHELL || '/bin/zsh');
  const args = process.platform === 'win32' ? [] : ['-lc', 'claude'];

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
  console.log(`claude-gui-daemon listening on ${PORT}`);
});
