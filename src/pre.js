function TLSSocket(host, socket) {
  this.host = host;
  this.socket = socket;
  this.bufferApp = [];
  this.bufferRec = [];

  this.clientContext = _malloc(Module._get_br_ssl_client_context_size());
  this.x509Context = _malloc(Module._get_br_x509_minimal_context_size());
  this.iobuf = _malloc(Module._get_iobuf_size());
  this.engineContext = Module._get_br_ssl_engine_context();
  this.hostPtr = _malloc(lengthBytesUTF8(host) + 1);
  stringToUTF8(host, hostPtr);

  var ok = Module._init_client(
    this.clientContext,
    this.x509Context,
    this.iobuf,
    this.hostPtr
  );

  if (ok !== 1) {
    throw new Error('init_client error');
  }

  socket.onopen = this._onopen.bind(this);
  socket.onmessage = this._onmessage.bind(this);
  socket.onerror = this._onerror.bind(this);
  socket.onclose = this._onclose.bind(this);

  this._process();
}

function initStaticMembers() {
  TLSSocket.BR_ERR_OK = Module._get_BR_ERR_OK();
  TLSSocket.BR_SSL_CLOSED = Module._get_BR_SSL_CLOSED();
  TLSSocket.BR_SSL_RECVAPP = Module._get_BR_SSL_RECVAPP();
  TLSSocket.BR_SSL_SENDAPP = Module._get_BR_SSL_SENDAPP();
  TLSSocket.BR_SSL_RECVREC = Module._get_BR_SSL_RECVREC();
  TLSSocket.BR_SSL_SENDREC = Module._get_BR_SSL_SENDREC();
}

if (Module['calledRun']) {
    initStaticMembers();
  } else {
    var old = Module['onRuntimeInitialized'];
    Module['onRuntimeInitialized'] = function() {
      if (old) old();
      initStaticMembers();
    };
}

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
  this.socket.close();
};

TLSSocket.prototype._onopen = function() {
};

TLSSocket.prototype._onmessage = function(event) {
  this.bufferRec.push(event.data);
  this._process();
};

TLSSocket.prototype._onerror = function(error) {
  this.close();
};

TLSSocket.prototype._onclose = function() {
  this.close();
};

// TODO: assuming data is Uint8Array
TLSSocket.prototype.send = function(data) {
  this.bufferApp.push(data);
  this._process();
}

TLSSocket.prototype._process = function() {
  while (true) {
    var st = Module._br_ssl_engine_current_state(this.engineContext);
    if (st === TLSSocket.BR_SSL_CLOSED) {
      var err = Module._br_ssl_engine_last_error(this.engineContext);
      if (err === TLSSocket.BR_ERR_OK) {
        console.log('SSL closed normally');
        this.close();
        break;
      } else {
        console.log('ERROR: SSL error', err);
        this.close();
        break;
      }
    }

    // recvapp: obtain some application data (plaintext) from the engine.
		var recvapp = ((st & TLSSocket.BR_SSL_RECVAPP) !== 0);
    if (recvapp) {
      var buf = Module._br_ssl_engine_recvapp_buf();
      if (buf) {
        // TODO: read
        if (this.onmessage) {
          this.onmessage({ data: data });
        }
        Module._br_ssl_engine_recvapp_ack();
        continue;
      }
    }

    // sendrec: get records from the engine, to be conveyed to the peer.
    var sendrec = ((st & TLSSocket.BR_SSL_SENDREC) !== 0);
    if (sendrec) {
      var buf = Module._br_ssl_engine_sendrec_buf();
      if (buf) {
        // TODO: read
        this.socket.send();
        Module._br_ssl_engine_sendrec_ack();
        continue;
      }
    }

    // recvrec: inject records freshly obtained from the peer, into the engine.
    var recvrec = ((st & TLSSocket.BR_SSL_RECVREC) !== 0);
    if (recvrec && this.bufferRec.length > 0) {
      continue;
    }

    // sendapp: push some application data (plaintext) into the engine.
    var sendapp = ((st & TLSSocket.BR_SSL_SENDAPP) !== 0);
    if (sendapp && this.bufferApp.length > 0) {
      continue;
    }

    break;
  }
};

Module.TLSSocket = TLSSocket;
