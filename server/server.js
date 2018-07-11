const net = require('net');
const WebSocketServer = require('uws').Server;

const { LISTEN_PORT, TARGET_HOST, TARGET_PORT, DEBUG } = process.env;
if (!LISTEN_PORT || !TARGET_HOST || !TARGET_PORT) {
  throw new Error('LISTEN_PORT, TARGET_HOST and TARGET_PORT need to be defined');
}

const log = DEBUG ? console.log.bind(console) : () => {};

const wss = new WebSocketServer({ port: LISTEN_PORT });

// TODO: this needs to be tested with scenarios like network errors, sockets
// that are never closed, etc. Also probably want some healthchecks and timeouts,
// especially for websockets.

wss.on('connection', (ws) => {
  let buffer = [];
  const socket = new net.Socket();
  socket.on('data', data => {
    log('socket -> ws', data);
    ws.send(data);
  });
  socket.on('close', () => {
    log('socket close');
    ws.close();
  });
  socket.on('error', (e) => {
    log('socket error', e);
    ws.terminate();
  });

  ws.on('message', (_data) => {
    // TODO: check that data is ArrayBuffer
    // uws library tries to avoid copying data for perf reasons.
    // Apparently, so does socket.write. So we need to copy the data ourselves
    // to ensure that is not modified before it's actually sent through the
    // socket.
    // First call creates a Buffer that shares memory with input ArrayBuffer,
    // second one allocates a new one.
    const data = Buffer.from(Buffer.from(_data));
    log('ws -> socket', data);
    socket.write(data);
  });
  ws.on('error', (e) => {
    log('ws error', e);
    socket.destroy();
  });

  socket.connect(TARGET_PORT, TARGET_HOST);
});
