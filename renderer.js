const term = new Terminal({
  cursorBlink: true,
  fontSize: 14,
  fontFamily: 'Menlo, Monaco, monospace',
  theme: { background: '#1e1e1e' },
});

const fitAddon = new FitAddon.FitAddon();
term.loadAddon(fitAddon);
term.open(document.getElementById('terminal'));
fitAddon.fit();
term.focus();

// Plain browser WebSocket — no Electron-specific API. This same code runs
// unmodified in a real browser tab once the daemon is reachable over the network.
const socket = new WebSocket(`ws://localhost:4317`);

socket.addEventListener('open', () => {
  syncSize();
});

socket.addEventListener('message', (event) => {
  term.write(event.data);
});

term.onData((data) => {
  if (socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({ t: 'i', d: data }));
  }
});

function syncSize() {
  fitAddon.fit();
  if (socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({ t: 'r', cols: term.cols, rows: term.rows }));
  }
}

window.addEventListener('resize', syncSize);
