// Test transport only: the original HTTP pages and WebSocket protocol pass through unchanged.
import http from 'node:http';
import WebSocket, { WebSocketServer } from 'ws';
export async function startDelayedProxy(backendPort, frontPort, delayMs) {
  const peers = new Set();
  const server = http.createServer((req, res) => {
    const upstream = http.request({ hostname: '127.0.0.1', port: backendPort, path: req.url, method: req.method, headers: req.headers }, response => {
      res.writeHead(response.statusCode, response.headers); response.pipe(res);
    });
    upstream.on('error', () => { res.writeHead(502); res.end(); }); req.pipe(upstream);
  });
  const sockets = new WebSocketServer({ server });
  sockets.on('connection', (down, req) => {
    const up = new WebSocket(`ws://127.0.0.1:${backendPort}${req.url}`, req.headers.origin ? { origin: req.headers.origin } : {});
    peers.add(down); peers.add(up); const queue = [];
    const deliver = (socket, raw, binary) => setTimeout(() => { if (socket.readyState === WebSocket.OPEN) socket.send(raw, { binary }); }, delayMs);
    down.on('message', (raw, binary) => { if (up.readyState === WebSocket.OPEN) deliver(up, raw, binary); else queue.push([raw, binary]); });
    up.on('open', () => { for (const [raw, binary] of queue) deliver(up, raw, binary); queue.length = 0; });
    up.on('message', (raw, binary) => deliver(down, raw, binary));
    up.on('close', () => { peers.delete(up); if (down.readyState < WebSocket.CLOSING) down.close(); });
    down.on('close', () => { peers.delete(down); up.terminate(); });
    up.on('error', () => down.terminate()); down.on('error', () => up.terminate());
  });
  await new Promise(resolve => server.listen(frontPort, '127.0.0.1', resolve));
  return { close() { for (const peer of peers) peer.terminate(); sockets.close(); server.closeAllConnections(); server.close(); } };
}
