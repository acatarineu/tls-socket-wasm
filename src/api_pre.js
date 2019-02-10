/* eslint-disable */

var _TextEncoder = typeof TextEncoder !== 'undefined' ? TextEncoder : require('util').TextEncoder;
var encoder = new _TextEncoder();

function toByteArray(data) {
  if (typeof data === 'string') {
    return encoder.encode(data);
  } else if (ArrayBuffer.isView(data)) {
    return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  }
  return new Uint8Array(data);
}

// TODO: prepare for socket that returns Blobs?

/* Important: close() must be called once done with the socket so that it frees
   the internally allocated HEAP memory. If not, it will eventually throw
   an out-of-memory error.

   Therefore, there is also a limit of concurrent connections that can run without
   running out of memory, which depends on the TOTAL_MEMORY allocated on build time.
   If this limit is hit, we could either increase this memory or compile with the
   flag ALLOW_MEMORY_GROWTH.
*/
function TLSSocket(host, socket, options) {
  // socket is already open (ready to send data)
  options = options || {};
  this.id = Math.floor(Math.random() * Number.MAX_SAFE_INTEGER);
  this.log = options.debug ? console.log.bind(console, '[TLSSocket]', this.id, host) : function noop() {};
  this.host = host;
  this.socket = socket;
  this.bufferApp = [];
  this.bufferRec = [];

  this.clientContext = _malloc(Module._get_br_ssl_client_context_size());
  this.x509Context = _malloc(Module._get_br_x509_minimal_context_size());
  this.iobuf = _malloc(Module._get_iobuf_size());
  this.engineContext = Module._get_br_ssl_engine_context(this.clientContext);
  this.hostPtr = _malloc(lengthBytesUTF8(host) + 1);
  stringToUTF8(host, this.hostPtr, lengthBytesUTF8(host) + 1);

  var ok = Module._init_client(
    this.clientContext,
    this.x509Context,
    this.iobuf,
    this.hostPtr
  );

  if (ok !== 1) {
    this.close();
    throw new Error('init_client error');
  }

  socket.onmessage = this._onmessage.bind(this);
  socket.onerror = this._onerror.bind(this);
  socket.onclose = this._onclose.bind(this);

  this._process();
}

TLSSocket.prototype._onmessage = function(event) {
  this.bufferRec.push(toByteArray(event.data));
  this._process();
};

TLSSocket.prototype._onerror = function(error) {
  if (this.onerror) {
    try {
      this.onerror(error);
    } catch (e) {
      this.log('onerror error', e);
    }
  }
  this.close();
};

TLSSocket.prototype._onclose = function() {
  this.close();
};

TLSSocket.prototype.close = function() {
  // TODO: should we distinguish closing from websocket and from ssl socket (engine)?
  // TODO: signal SSL that we are closed
  if (this.closed) {
    return;
  }
  _free(this.clientContext);
  _free(this.x509Context);
  _free(this.iobuf);
  _free(this.hostPtr);
  this.closed = true;
  delete this.socket.onopen;
  delete this.socket.onmessage;
  delete this.socket.onerror;
  delete this.socket.onclose;
  try {
    this.socket.close();
  } catch (e) {
    this.log('socket.close error', e);
  }
  if (this.onclose) {
    try {
      this.onclose();
    } catch (e) {
      this.log('onclose error', e);
    }
  }
};

// TODO: assuming data is Uint8Array
TLSSocket.prototype.send = function(data) {
  this.bufferApp.push(toByteArray(data));
  this._process();
}

TLSSocket.prototype._process = function() {
  while (true) {
    var st = Module._br_ssl_engine_current_state(this.engineContext);
    if (st === TLSSocket.BR_SSL_CLOSED) {
      var err = Module._br_ssl_engine_last_error(this.engineContext);
      if (err === TLSSocket.BR_ERR_OK) {
        this.log('SSL closed normally');
        this.close();
        break;
      } else {
        // TODO: maybe we could also use the comments (2nd argument)
        var errName = UTF8ToString(Module._find_error_name(err, 0));
        var errorMsg = 'ERROR: SSL error ' + errName + ' (' + err + ')';
        this.log(errorMsg);
        this._onerror(new Error(errName));
        break;
      }
    }

    // recvapp: obtain some application data (plaintext) from the engine.
		var recvapp = ((st & TLSSocket.BR_SSL_RECVAPP) !== 0);
    this.log('recvapp', recvapp);
    if (recvapp) {
      var ptr = _malloc(4);
      var buf = Module._br_ssl_engine_recvapp_buf(this.engineContext, ptr);
      var len = getValue(ptr, 'i32');
      _free(ptr);
      // TODO: do we need to slice?
      var data = (new Uint8Array(HEAPU8.buffer, buf, len)).slice();
      if (this.onmessage) {
        try {
          this.onmessage({ data: data });
        } catch (e) {
          this.log('onmessage error', data);
        }
      }
      Module._br_ssl_engine_recvapp_ack(this.engineContext, len);
      continue;
    }

    // sendrec: get records from the engine, to be conveyed to the peer.
    var sendrec = ((st & TLSSocket.BR_SSL_SENDREC) !== 0);
    this.log('sendrec', sendrec);
    if (sendrec) {
      var ptr = _malloc(4);
      var buf = Module._br_ssl_engine_sendrec_buf(this.engineContext, ptr);
      var len = getValue(ptr, 'i32');
      _free(ptr);
      // TODO: do we need to slice?
      var data = (new Uint8Array(HEAPU8.buffer, buf, len)).slice();
      try {
        this.socket.send(data);
      } catch (e) {
        this._onerror(e);
        break;
      }
      Module._br_ssl_engine_sendrec_ack(this.engineContext, len);
      continue;
    }

    // recvrec: inject records freshly obtained from the peer, into the engine.
    var recvrec = ((st & TLSSocket.BR_SSL_RECVREC) !== 0);
    this.log('recvrec', recvrec, this.bufferRec.length, this.bufferRec);
    if (recvrec && this.bufferRec.length > 0) {
      var ptr = _malloc(4);
      var buf = Module._br_ssl_engine_recvrec_buf(this.engineContext, ptr);
      var len = getValue(ptr, 'i32');
      _free(ptr);
      var data = new Uint8Array(HEAPU8.buffer, buf, len);
      var dataInput = this.bufferRec[0];
      if (len >= dataInput.length) {
        len = dataInput.length;
        data.set(dataInput);
        this.bufferRec.splice(0, 1);
      } else {
        data.set(dataInput.subarray(0, len));
        this.bufferRec[0] = dataInput.subarray(len);
      }
      Module._br_ssl_engine_recvrec_ack(this.engineContext, len);
      continue;
    }

    // sendapp: push some application data (plaintext) into the engine.
    var sendapp = ((st & TLSSocket.BR_SSL_SENDAPP) !== 0);
    this.log('sendapp', sendapp, this.bufferApp.length, this.bufferApp);
    if (sendapp && this.bufferApp.length > 0) {
      var ptr = _malloc(4);
      var buf = Module._br_ssl_engine_sendapp_buf(this.engineContext, ptr);
      var len = getValue(ptr, 'i32');
      _free(ptr);
      var data = new Uint8Array(HEAPU8.buffer, buf, len);
      var dataInput = this.bufferApp[0];
      if (len >= dataInput.length) {
        len = dataInput.length;
        data.set(dataInput);
        this.bufferApp.splice(0, 1);
      } else {
        data.set(dataInput.subarray(0, len));
        this.bufferApp[0] = dataInput.subarray(len);
      }
      Module._br_ssl_engine_sendapp_ack(this.engineContext, len);
      Module._br_ssl_engine_flush(this.engineContext, 0);
      continue;
    }

    break;
  }
};

Module.TLSSocket = TLSSocket;
