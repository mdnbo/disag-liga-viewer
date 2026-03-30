/**
 * Minimal WebSocket server implementation (RFC 6455)
 * No external dependencies needed.
 */
const crypto = require('crypto');
const { EventEmitter } = require('events');

const MAGIC = '258EAFA5-E914-47DA-95CA-5AB4AA29E5E5';

class WebSocketClient extends EventEmitter {
  constructor(socket) {
    super();
    this.socket = socket;
    this.readyState = 1; // OPEN
    this._buffer = Buffer.alloc(0);

    socket.on('data', (data) => this._onData(data));
    socket.on('close', () => {
      this._markClosed();
    });
    socket.on('error', () => {
      // Swallow socket errors (EPIPE, ECONNRESET, etc.) — just mark as closed
      this._markClosed();
    });
  }

  _markClosed() {
    if (this.readyState === 3) return; // already closed
    this.readyState = 3;
    this.socket.destroy();
    this.emit('close');
  }

  send(data) {
    if (this.readyState !== 1) return;
    try {
      const payload = Buffer.from(data, 'utf8');
      const frame = this._createFrame(payload, 0x01);
      if (this.socket.writable) {
        this.socket.write(frame);
      } else {
        this._markClosed();
      }
    } catch(e) {
      this._markClosed();
    }
  }

  close() {
    if (this.readyState !== 1) return;
    this.readyState = 2;
    try {
      const frame = this._createFrame(Buffer.alloc(0), 0x08);
      if (this.socket.writable) this.socket.write(frame);
    } catch(e) {}
    this.socket.destroy();
    this.readyState = 3;
  }

  _createFrame(payload, opcode) {
    const len = payload.length;
    let header;
    if (len < 126) {
      header = Buffer.alloc(2);
      header[0] = 0x80 | opcode;
      header[1] = len;
    } else if (len < 65536) {
      header = Buffer.alloc(4);
      header[0] = 0x80 | opcode;
      header[1] = 126;
      header.writeUInt16BE(len, 2);
    } else {
      header = Buffer.alloc(10);
      header[0] = 0x80 | opcode;
      header[1] = 127;
      header.writeBigUInt64BE(BigInt(len), 2);
    }
    return Buffer.concat([header, payload]);
  }

  _onData(data) {
    this._buffer = Buffer.concat([this._buffer, data]);
    while (this._buffer.length >= 2) {
      const frame = this._parseFrame();
      if (!frame) break;
      this._handleFrame(frame);
    }
  }

  _parseFrame() {
    const buf = this._buffer;
    if (buf.length < 2) return null;

    const byte1 = buf[0];
    const byte2 = buf[1];
    const opcode = byte1 & 0x0f;
    const masked = (byte2 & 0x80) !== 0;
    let payloadLen = byte2 & 0x7f;
    let offset = 2;

    if (payloadLen === 126) {
      if (buf.length < 4) return null;
      payloadLen = buf.readUInt16BE(2);
      offset = 4;
    } else if (payloadLen === 127) {
      if (buf.length < 10) return null;
      payloadLen = Number(buf.readBigUInt64BE(2));
      offset = 10;
    }

    const maskSize = masked ? 4 : 0;
    const totalLen = offset + maskSize + payloadLen;
    if (buf.length < totalLen) return null;

    let mask = null;
    if (masked) {
      mask = buf.slice(offset, offset + 4);
      offset += 4;
    }

    let payload = buf.slice(offset, offset + payloadLen);
    if (mask) {
      payload = Buffer.from(payload);
      for (let i = 0; i < payload.length; i++) {
        payload[i] ^= mask[i % 4];
      }
    }

    this._buffer = buf.slice(totalLen);
    return { opcode, payload };
  }

  _handleFrame(frame) {
    switch (frame.opcode) {
      case 0x01: // text
        this.emit('message', frame.payload.toString('utf8'));
        break;
      case 0x02: // binary
        this.emit('message', frame.payload);
        break;
      case 0x08: // close
        this.close();
        break;
      case 0x09: // ping
        const pong = this._createFrame(frame.payload, 0x0a);
        try { this.socket.write(pong); } catch(e) {}
        break;
      case 0x0a: // pong
        break;
    }
  }
}

class WebSocketServer extends EventEmitter {
  constructor({ server }) {
    super();
    server.on('upgrade', (req, socket, head) => {
      const key = req.headers['sec-websocket-key'];
      if (!key) { socket.destroy(); return; }

      // Handle socket errors during handshake
      socket.on('error', () => { socket.destroy(); });

      const accept = crypto
        .createHash('sha1')
        .update(key + MAGIC)
        .digest('base64');

      try {
        socket.write(
          'HTTP/1.1 101 Switching Protocols\r\n' +
          'Upgrade: websocket\r\n' +
          'Connection: Upgrade\r\n' +
          `Sec-WebSocket-Accept: ${accept}\r\n` +
          '\r\n'
        );
      } catch(e) {
        socket.destroy();
        return;
      }

      const client = new WebSocketClient(socket);
      console.log(`   WS: Client verbunden (${req.socket.remoteAddress})`);
      this.emit('connection', client, req);
    });
  }
}

module.exports = { WebSocketServer, WebSocketClient };
