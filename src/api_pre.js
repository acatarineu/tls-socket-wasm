// From creationix/http-parser-js
// #if ASSERTIONS
// #else
// var assert = function() {};
// #endif

function HTTPParser(type) {
  // assert.ok(type === HTTPParser.REQUEST || type === HTTPParser.RESPONSE);
  this.type = type;
  this.state = type + '_LINE';
  this.info = {
    headers: [],
    upgrade: false
  };
  this.trailers = [];
  this.line = '';
  this.isChunked = false;
  this.connection = '';
  this.headerSize = 0; // for preventing too big headers
  this.body_bytes = null;
  this.isUserCall = false;
  this.hadError = false;
}
HTTPParser.encoding = 'ascii';
HTTPParser.maxHeaderSize = 80 * 1024; // maxHeaderSize (in bytes) is configurable, but 80kb by default;
HTTPParser.REQUEST = 'REQUEST';
HTTPParser.RESPONSE = 'RESPONSE';
var kOnHeaders = HTTPParser.kOnHeaders = 0;
var kOnHeadersComplete = HTTPParser.kOnHeadersComplete = 1;
var kOnBody = HTTPParser.kOnBody = 2;
var kOnMessageComplete = HTTPParser.kOnMessageComplete = 3;

// Some handler stubs, needed for compatibility
HTTPParser.prototype[kOnHeaders] =
HTTPParser.prototype[kOnHeadersComplete] =
HTTPParser.prototype[kOnBody] =
HTTPParser.prototype[kOnMessageComplete] = function () {};

var compatMode0_12 = true;
Object.defineProperty(HTTPParser, 'kOnExecute', {
    get: function () {
      // hack for backward compatibility
      compatMode0_12 = false;
      return 4;
    }
  });

var methods = HTTPParser.methods = [
  'DELETE',
  'GET',
  'HEAD',
  'POST',
  'PUT',
  'CONNECT',
  'OPTIONS',
  'TRACE',
  'COPY',
  'LOCK',
  'MKCOL',
  'MOVE',
  'PROPFIND',
  'PROPPATCH',
  'SEARCH',
  'UNLOCK',
  'BIND',
  'REBIND',
  'UNBIND',
  'ACL',
  'REPORT',
  'MKACTIVITY',
  'CHECKOUT',
  'MERGE',
  'M-SEARCH',
  'NOTIFY',
  'SUBSCRIBE',
  'UNSUBSCRIBE',
  'PATCH',
  'PURGE',
  'MKCALENDAR',
  'LINK',
  'UNLINK'
];
var method_connect = methods.indexOf('CONNECT');
HTTPParser.prototype.reinitialize = HTTPParser;
HTTPParser.prototype.close =
HTTPParser.prototype.pause =
HTTPParser.prototype.resume =
HTTPParser.prototype.free = function () {};
HTTPParser.prototype._compatMode0_11 = false;
HTTPParser.prototype.getAsyncId = function() { return 0; };

var headerState = {
  REQUEST_LINE: true,
  RESPONSE_LINE: true,
  HEADER: true
};
HTTPParser.prototype.execute = function (chunk, start, length) {
  if (!(this instanceof HTTPParser)) {
    throw new TypeError('not a HTTPParser');
  }

  // backward compat to node < 0.11.4
  // Note: the start and length params were removed in newer version
  start = start || 0;
  length = typeof length === 'number' ? length : chunk.length;

  this.chunk = chunk;
  this.offset = start;
  var end = this.end = start + length;
  try {
    while (this.offset < end) {
      if (this[this.state]()) {
        break;
      }
    }
  } catch (err) {
    if (this.isUserCall) {
      throw err;
    }
    this.hadError = true;
    return err;
  }
  this.chunk = null;
  length = this.offset - start;
  if (headerState[this.state]) {
    this.headerSize += length;
    if (this.headerSize > HTTPParser.maxHeaderSize) {
      return new Error('max header size exceeded');
    }
  }
  return length;
};

var stateFinishAllowed = {
  REQUEST_LINE: true,
  RESPONSE_LINE: true,
  BODY_RAW: true
};
HTTPParser.prototype.finish = function () {
  if (this.hadError) {
    return;
  }
  if (!stateFinishAllowed[this.state]) {
    return new Error('invalid state for EOF');
  }
  if (this.state === 'BODY_RAW') {
    this.userCall()(this[kOnMessageComplete]());
  }
};

// These three methods are used for an internal speed optimization, and it also
// works if theses are noops. Basically consume() asks us to read the bytes
// ourselves, but if we don't do it we get them through execute().
HTTPParser.prototype.consume =
HTTPParser.prototype.unconsume =
HTTPParser.prototype.getCurrentBuffer = function () {};

//For correct error handling - see HTTPParser#execute
//Usage: this.userCall()(userFunction('arg'));
HTTPParser.prototype.userCall = function () {
  this.isUserCall = true;
  var self = this;
  return function (ret) {
    self.isUserCall = false;
    return ret;
  };
};

HTTPParser.prototype.nextRequest = function () {
  this.userCall()(this[kOnMessageComplete]());
  this.reinitialize(this.type);
};

HTTPParser.prototype.consumeLine = function () {
  var decoder = new TextDecoder(HTTPParser.encoding);
  var end = this.end,
      chunk = this.chunk;
  for (var i = this.offset; i < end; i++) {
    if (chunk[i] === 0x0a) { // \n
      // WARNING: this has been changed, assuming input is Uint8Array
      var line = this.line + decoder.decode(chunk.subarray(this.offset, i));
      if (line.charAt(line.length - 1) === '\r') {
        line = line.substr(0, line.length - 1);
      }
      this.line = '';
      this.offset = i + 1;
      return line;
    }
  }
  //line split over multiple chunks
  this.line += chunk.toString(HTTPParser.encoding, this.offset, this.end);
  this.offset = this.end;
};

var headerExp = /^([^: \t]+):[ \t]*((?:.*[^ \t])|)/;
var headerContinueExp = /^[ \t]+(.*[^ \t])/;
HTTPParser.prototype.parseHeader = function (line, headers) {
  if (line.indexOf('\r') !== -1) {
    throw parseErrorCode('HPE_LF_EXPECTED');
  }

  var match = headerExp.exec(line);
  var k = match && match[1];
  if (k) { // skip empty string (malformed header)
    headers.push(k);
    headers.push(match[2]);
  } else {
    var matchContinue = headerContinueExp.exec(line);
    if (matchContinue && headers.length) {
      if (headers[headers.length - 1]) {
        headers[headers.length - 1] += ' ';
      }
      headers[headers.length - 1] += matchContinue[1];
    }
  }
};

var requestExp = /^([A-Z-]+) ([^ ]+) HTTP\/(\d)\.(\d)$/;
HTTPParser.prototype.REQUEST_LINE = function () {
  var line = this.consumeLine();
  if (!line) {
    return;
  }
  var match = requestExp.exec(line);
  if (match === null) {
    throw parseErrorCode('HPE_INVALID_CONSTANT');
  }
  this.info.method = this._compatMode0_11 ? match[1] : methods.indexOf(match[1]);
  if (this.info.method === -1) {
    throw new Error('invalid request method');
  }
  this.info.url = match[2];
  this.info.versionMajor = +match[3];
  this.info.versionMinor = +match[4];
  this.body_bytes = 0;
  this.state = 'HEADER';
};

var responseExp = /^HTTP\/(\d)\.(\d) (\d{3}) ?(.*)$/;
HTTPParser.prototype.RESPONSE_LINE = function () {
  var line = this.consumeLine();
  if (!line) {
    return;
  }
  var match = responseExp.exec(line);
  if (match === null) {
    throw parseErrorCode('HPE_INVALID_CONSTANT');
  }
  this.info.versionMajor = +match[1];
  this.info.versionMinor = +match[2];
  var statusCode = this.info.statusCode = +match[3];
  this.info.statusMessage = match[4];
  // Implied zero length.
  if ((statusCode / 100 | 0) === 1 || statusCode === 204 || statusCode === 304) {
    this.body_bytes = 0;
  }
  this.state = 'HEADER';
};

HTTPParser.prototype.shouldKeepAlive = function () {
  if (this.info.versionMajor > 0 && this.info.versionMinor > 0) {
    if (this.connection.indexOf('close') !== -1) {
      return false;
    }
  } else if (this.connection.indexOf('keep-alive') === -1) {
    return false;
  }
  if (this.body_bytes !== null || this.isChunked) { // || skipBody
    return true;
  }
  return false;
};

HTTPParser.prototype.HEADER = function () {
  var line = this.consumeLine();
  if (line === undefined) {
    return;
  }
  var info = this.info;
  if (line) {
    this.parseHeader(line, info.headers);
  } else {
    var headers = info.headers;
    var hasContentLength = false;
    var currentContentLengthValue;
    var hasUpgradeHeader = false;
    for (var i = 0; i < headers.length; i += 2) {
      switch (headers[i].toLowerCase()) {
        case 'transfer-encoding':
          this.isChunked = headers[i + 1].toLowerCase() === 'chunked';
          break;
        case 'content-length':
          currentContentLengthValue = +headers[i + 1];
          if (hasContentLength) {
            // Fix duplicate Content-Length header with same values.
            // Throw error only if values are different.
            // Known issues:
            // https://github.com/request/request/issues/2091#issuecomment-328715113
            // https://github.com/nodejs/node/issues/6517#issuecomment-216263771
            if (currentContentLengthValue !== this.body_bytes) {
              throw parseErrorCode('HPE_UNEXPECTED_CONTENT_LENGTH');
            }
          } else {
            hasContentLength = true;
            this.body_bytes = currentContentLengthValue;
          }
          break;
        case 'connection':
          this.connection += headers[i + 1].toLowerCase();
          break;
        case 'upgrade':
          hasUpgradeHeader = true;
          break;
      }
    }

    // See https://github.com/creationix/http-parser-js/pull/53
    // if both isChunked and hasContentLength, content length wins
    // because it has been verified to match the body length already
    if (this.isChunked && hasContentLength) {
      this.isChunked = false;
    }

    // Logic from https://github.com/nodejs/http-parser/blob/921d5585515a153fa00e411cf144280c59b41f90/http_parser.c#L1727-L1737
    // "For responses, "Upgrade: foo" and "Connection: upgrade" are
    //   mandatory only when it is a 101 Switching Protocols response,
    //   otherwise it is purely informational, to announce support.
    if (hasUpgradeHeader && this.connection.indexOf('upgrade') != -1) {
      info.upgrade = this.type === HTTPParser.REQUEST || info.statusCode === 101;
    } else {
      info.upgrade = info.method === method_connect;
    }

    info.shouldKeepAlive = this.shouldKeepAlive();
    //problem which also exists in original node: we should know skipBody before calling onHeadersComplete
    var skipBody;
    if (compatMode0_12) {
      skipBody = this.userCall()(this[kOnHeadersComplete](info));
    } else {
      skipBody = this.userCall()(this[kOnHeadersComplete](info.versionMajor,
          info.versionMinor, info.headers, info.method, info.url, info.statusCode,
          info.statusMessage, info.upgrade, info.shouldKeepAlive));
    }
    if (skipBody === 2) {
      this.nextRequest();
      return true;
    } else if (this.isChunked && !skipBody) {
      this.state = 'BODY_CHUNKHEAD';
    } else if (skipBody || this.body_bytes === 0) {
      this.nextRequest();
      // For older versions of node (v6.x and older?), that return skipBody=1 or skipBody=true,
      //   need this "return true;" if it's an upgrade request.
      return info.upgrade;
    } else if (this.body_bytes === null) {
      this.state = 'BODY_RAW';
    } else {
      this.state = 'BODY_SIZED';
    }
  }
};

HTTPParser.prototype.BODY_CHUNKHEAD = function () {
  var line = this.consumeLine();
  if (line === undefined) {
    return;
  }
  this.body_bytes = parseInt(line, 16);
  if (!this.body_bytes) {
    this.state = 'BODY_CHUNKTRAILERS';
  } else {
    this.state = 'BODY_CHUNK';
  }
};

HTTPParser.prototype.BODY_CHUNK = function () {
  var length = Math.min(this.end - this.offset, this.body_bytes);
  this.userCall()(this[kOnBody](this.chunk, this.offset, length));
  this.offset += length;
  this.body_bytes -= length;
  if (!this.body_bytes) {
    this.state = 'BODY_CHUNKEMPTYLINE';
  }
};

HTTPParser.prototype.BODY_CHUNKEMPTYLINE = function () {
  var line = this.consumeLine();
  if (line === undefined) {
    return;
  }
  // assert.equal(line, '');
  this.state = 'BODY_CHUNKHEAD';
};

HTTPParser.prototype.BODY_CHUNKTRAILERS = function () {
  var line = this.consumeLine();
  if (line === undefined) {
    return;
  }
  if (line) {
    this.parseHeader(line, this.trailers);
  } else {
    if (this.trailers.length) {
      this.userCall()(this[kOnHeaders](this.trailers, ''));
    }
    this.nextRequest();
  }
};

HTTPParser.prototype.BODY_RAW = function () {
  var length = this.end - this.offset;
  this.userCall()(this[kOnBody](this.chunk, this.offset, length));
  this.offset = this.end;
};

HTTPParser.prototype.BODY_SIZED = function () {
  var length = Math.min(this.end - this.offset, this.body_bytes);
  this.userCall()(this[kOnBody](this.chunk, this.offset, length));
  this.offset += length;
  this.body_bytes -= length;
  if (!this.body_bytes) {
    this.nextRequest();
  }
};

// backward compat to node < 0.11.6
['Headers', 'HeadersComplete', 'Body', 'MessageComplete'].forEach(function (name) {
  var k = HTTPParser['kOn' + name];
  Object.defineProperty(HTTPParser.prototype, 'on' + name, {
    get: function () {
      return this[k];
    },
    set: function (to) {
      // hack for backward compatibility
      this._compatMode0_11 = true;
      method_connect = 'CONNECT';
      return (this[k] = to);
    }
  });
});

function parseErrorCode(code) {
  var err = new Error('Parse Error');
  err.code = code;
  return err;
}

// end creationix/http-parser-js


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


// makeDataChannel receives a hostname and port, and returns a Promise which
// resolves to an open socket-like object.
function minifetch(makeDataChannel, url, options) {
  options = options || {};
  var log = options.debug ? console.log.bind(console, '[minifetch]', url) : function noop() {};

  if (typeof url !== 'string') {
    throw new Error('Url must be a string');
  }
  if (options === null || (typeof options !== "object" && options !== undefined)) {
    throw new Error("Options must be an object or undefined");
  }
  var whitelistedOptions = ['method', 'body', 'debug', 'headers', 'timeout'];
  var method = 'GET';
  var body = undefined;
  if (options) {
    var keys = Object.keys(options).sort();
    var len = keys.length;
    for (var i = 0; i < len; i += 1) {
      if (whitelistedOptions.indexOf(keys[i]) === -1) {
        throw new Error('Option "' + keys[i] + '" is not supported');
      }
    }
    if (options.headers !== undefined) {
      options.headers = new Headers(options.headers);
    }
    if (options.method !== undefined) {
      if (typeof options.method !== 'string') {
        throw new Error('Method must be a string');
      }
      var whitelistedMethods = ['GET', 'POST', 'CONNECT'];
      method = options.method.toUpperCase();
      if (whitelistedMethods.indexOf(method) === -1) {
        throw new Error('Method "' + method + '" is not supported');
      }
    }
    if (options.body !== undefined) {
      if (options.body instanceof ArrayBuffer) {
        body = new Uint8Array(options.body);
      } else if (ArrayBuffer.isView(options.body)) {
        body = new Uint8Array(options.body.buffer, options.body.byteOffset, options.body.byteLength);
      } else if (typeof options.body === 'string') {
        body = (new TextEncoder()).encode(options.body);
      } else {
        throw new Error('Unsupported body type');
      }
    }
  }

  var url = new URL(url);
  var protocol = url.protocol;
  if (protocol !== 'http:' && protocol !== 'https:') {
    throw new Error('Unsupported protocol "' + protocol + '"');
  }
  var port = url.port || (protocol === 'http:' ? '80' : '443');
  var pathname = method === 'CONNECT' ? url.host : url.pathname;

  // Let's build the raw request, easy!
  var request = '';
  request += method + ' ' + pathname + ' HTTP/1.1\r\n';
  request += 'Host: ' + url.host + '\r\n';
  request += 'Connection: close\r\n'; // keep-alive?
  if (options.headers) {
    options.headers.forEach(function(value, key) {
      // TODO: need to be more strict
      request += key + ': ' + value + '\r\n';
    });
  }
  request += '\r\n';

  request = (new TextEncoder()).encode(request);
  if (body) {
    var tmp = new Uint8Array(request.length + body.length);
    tmp.set(request, 0);
    tmp.set(body, request.length);
    request = tmp;
  }

  // For simplicity, assuming responses will be small
  return Promise.resolve()
    .then(function() {
      return makeDataChannel(url.hostname, port);
    })
    .then(function(socket) {
      return protocol === 'https:' ? new TLSSocket(url.hostname, socket, options) : socket;
    })
    .then(function(socket) {
      return new Promise(function (resolve, reject) {
        if (options.timeout && typeof options.timeout === 'number') {
          setTimeout(function() {
            socket.close();
            reject(new Error('minifetch timeout'));
          }, options.timeout);
        }
        var parser = new HTTPParser(HTTPParser.RESPONSE);
        var kOnHeaders = HTTPParser.kOnHeaders | 0;
        var kOnHeadersComplete = HTTPParser.kOnHeadersComplete | 0;
        var kOnBody = HTTPParser.kOnBody | 0;
        var kOnMessageComplete = HTTPParser.kOnMessageComplete | 0;
        var kOnExecute = HTTPParser.kOnExecute | 0;

        var body = new Uint8Array();
        var versionMajor;
        var versionMinor;
        var headers;
        // var method;
        // var url;
        var statusCode;
        var statusMessage;
        var upgrade;
        var shouldKeepAlive;

        parser[kOnHeaders] = function(headers, url) {
          log('kOnHeaders');
        };
        parser[kOnHeadersComplete] = function(_versionMajor, _versionMinor, _headers, _method,
          _url, _statusCode, _statusMessage, _upgrade, _shouldKeepAlive)
        {
          versionMajor = _versionMajor;
          versionMinor = _versionMinor;
          headers = _headers || [];
          statusCode = _statusCode;
          statusMessage = _statusMessage;
          upgrade = _upgrade;
          shouldKeepAlive = _shouldKeepAlive;

          var realHeaders = new Map();
          for (var i = 0; i < headers.length; i += 2) {
            realHeaders.set(headers[i], headers[i + 1]);
          }
          headers = realHeaders;
          if (method === 'CONNECT') {
            // See skipBody
            return 2;
          }
        };
        parser[kOnBody] = function(b, start, len) {
          log('kOnBody', b, start, len);
          if (len > 0) {
            // FIXME: quite inefficient, but assuming bodies will not be very big...
            // TODO: set max body?
            var newBody = new Uint8Array(body.length + len);
            newBody.set(body);
            newBody.set(b.subarray(start, start + len), body.length);
            body = newBody;
          }
        };
        parser[kOnMessageComplete] = function() {
          log('kOnMessageComplete');
          var response = new Response(body, {
            status: statusCode,
            statusText: statusMessage,
            headers: new Headers(headers)
          });
          response._socket = socket;
          resolve(response);
          socket.close();
        };
        parser[kOnExecute] = function() {
          log('kOnExecute');
        };
        // TODO: timeout? AbortController?
        socket.onerror = function(error) {
          log('socket error', error);
          socket.close();
          reject(error || new Error('Socket error'));
          parser.close();
        };
        socket.onmessage = function(message) {
          log('socket message(1)', message);
          var data = toByteArray(message.data);
          log('socket message(2)', data);
          var len = data.length;
          var ret = parser.execute(data);
          if (ret !== len) {
            socket.close();
            reject(new Error('Invalid http response'));
          }
        };
        socket.onclose = function() {
          log('onclose(1)');
          var ret = parser.finish();
          log('onclose(2)', ret);
          reject(new Error('Closed before valid http response'));
          parser.close();
        };
        socket.send(request);
      });
    });
}


Module.TLSSocket = TLSSocket;
Module.minifetch = minifetch;
