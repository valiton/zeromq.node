/**
 * Module dependencies.
 */

var EventEmitter = require('events').EventEmitter
  , zmq = require('../build/Release/binding');

/**
 * Expose bindings as the module.
 */

exports = module.exports = zmq;

/**
 * Expose zmq version.
 */

exports.version = zmq.zmqVersion();

/**
 * Map of socket types.
 */

var types = exports.types = {
    pub: zmq.ZMQ_PUB
  , sub: zmq.ZMQ_SUB
  , req: zmq.ZMQ_REQ
  , xreq: zmq.ZMQ_XREQ
  , rep: zmq.ZMQ_REP
  , xrep: zmq.ZMQ_XREP
  , push: zmq.ZMQ_PUSH
  , pull: zmq.ZMQ_PULL
  , dealer: zmq.ZMQ_DEALER
  , router: zmq.ZMQ_ROUTER
  , pair: zmq.ZMQ_PAIR
};

/**
 * Map of socket options.
 */

var opts = exports.options = {
    _fd: zmq.ZMQ_FD
  , _ioevents: zmq.ZMQ_EVENTS
  , _receiveMore: zmq.ZMQ_RCVMORE
  , _subscribe: zmq.ZMQ_SUBSCRIBE
  , _unsubscribe: zmq.ZMQ_UNSUBSCRIBE
  , affinity: zmq.ZMQ_AFFINITY
  , backlog: zmq.ZMQ_BACKLOG
  , hwm: zmq.ZMQ_HWM
  , sndhwm: zmq.ZMQ_SNDHWM
  , rcvhwm: zmq.ZMQ_RCVHWM
  , identity: zmq.ZMQ_IDENTITY
  , linger: zmq.ZMQ_LINGER
  , mcast_loop: zmq.ZMQ_MCAST_LOOP
  , rate: zmq.ZMQ_RATE
  , rcvbuf: zmq.ZMQ_RCVBUF
  , reconnect_ivl: zmq.ZMQ_RECONNECT_IVL
  , recovery_ivl: zmq.ZMQ_RECOVERY_IVL
  , sndbuf: zmq.ZMQ_SNDBUF
  , swap: zmq.ZMQ_SWAP
};

// Context management happens here. We lazily initialize a default context,
// and use that everywhere. Also cleans up on exit.
var ctx;
function defaultContext() {
  if (ctx) return ctx;

  var io_threads = 1;
  if (process.env.ZMQ_IO_THREADS) {
    io_threads = parseInt(process.env.ZMQ_IO_THREADS, 10);
    if (!io_threads || io_threads < 1) {
      console.warn('Invalid number in ZMQ_IO_THREADS, using 1 IO thread.');
      io_threads = 1;
    }
  }

  ctx = new zmq.Context(io_threads);
  process.on('exit', function(){
    // ctx.close();
    ctx = null;
  });

  return ctx;
};

// prevent GC from touching connect and bindSync
function gcWrap (self) {}

/**
 * Create a new socket of the given `type`.
 *
 * @constructor
 * @param {String|Number} type
 * @api public
 */

function Socket(type) {
  this.type = type;
  this._zmq = new zmq.Socket(defaultContext(), types[type]);
  this._zmq.onReady = this._flush.bind(this);
  this._outgoing = [];
  this._shouldFlush = true;
};

/**
 * Inherit from `EventEmitter.prototype`.
 */

Socket.prototype.__proto__ = EventEmitter.prototype;

/**
 * Set `opt` to `val`.
 *
 * @param {String|Number} opt
 * @param {Mixed} val
 * @return {Socket} for chaining
 * @api public
 */

Socket.prototype.setsockopt = function(opt, val){
  this._zmq.setsockopt(opts[opt] || opt, val);
  return this;
};

/**
 * Get socket `opt`.
 *
 * @param {String|Number} opt
 * @return {Mixed}
 * @api public
 */

Socket.prototype.getsockopt = function(opt){
  return this._zmq.getsockopt(opts[opt] || opt);
};

/**
 * Socket opt accessors allowing `sock.backlog = val`
 * instead of `sock.setsockopt('backlog', val)`.
 */

Object.keys(opts).forEach(function(name){
  Socket.prototype.__defineGetter__(name, function() {
    return this._zmq.getsockopt(opts[name]);
  });

  Socket.prototype.__defineSetter__(name, function(val) {
    if ('string' == typeof val) val = new Buffer(val, 'utf8');
    return this._zmq.setsockopt(opts[name], val);
  });
});

/**
 * Async bind.
 *
 * Emits the "bind" event.
 *
 * @param {String} addr
 * @param {Function} cb
 * @return {Socket} for chaining
 * @api public
 */

Socket.prototype.bind = function(addr, cb) {
  var self = this;
  self._zmq.bind(addr, function(err) {
    self.emit('bind');
    cb && cb(err);
  });
  return this;
};

/**
 * Sync bind.
 *
 * @param {String} addr
 * @return {Socket} for chaining
 * @api public
 */

Socket.prototype.bindSync = function(addr) {
  try {
    this._zmq.bindSync(addr);
    setTimeout(gcWrap, 0, this);
  } catch (err) {
    throw err;
  }

  return this;
};

/**
 * Connect to `addr`.
 *
 * @param {String} addr
 * @return {Socket} for chaining
 * @api public
 */

Socket.prototype.connect = function(addr) {
  this._zmq.connect(addr);
  setTimeout(gcWrap, 0, this);
  return this;
};

/**
 * Subscribe with the given `filter`.
 *
 * @param {String} filter
 * @return {Socket} for chaining
 * @api public
 */

Socket.prototype.subscribe = function(filter) {
  this._subscribe = filter;
  return this;
};

/**
 * Unsubscribe with the given `filter`.
 *
 * @param {String} filter
 * @return {Socket} for chaining
 * @api public
 */

Socket.prototype.unsubscribe = function(filter) {
  this._unsubscribe = filter;
  return this;
};

/**
 * Send the given `msg`.
 *
 * @param {String|Buffer|Array} msg
 * @param {Number} flags
 * @return {Socket} for chaining
 * @api public
 */

Socket.prototype.send = function(msg, flags) {
  if (Array.isArray(msg)) {
    for (var i = 0, len = msg.length; i < len; i++) {
      this.send(msg[i], i < len - 1
        ? zmq.ZMQ_SNDMORE
        : flags);
    }
  } else {
    if (!Buffer.isBuffer(msg)) msg = new Buffer(String(msg), 'utf8');
    this.error_code = this._zmq.send(msg, flags) || 0;
  }

  return this;
};

// The workhorse that does actual send and receive operations.
// This helper is called from `send` above, and in response to
// the watcher noticing the signaller fd is readable.
Socket.prototype._flush = function() {
  var self = this
    , flushing = false
    , args;

  // Don't allow recursive flush invocation as it can lead to stack
  // exhaustion and write starvation
  if (this._flushing) return;

  this._flushing = true;
  try {
    while (true) {
      var emitArgs
        , flags = this._ioevents;

      if (!this._outgoing.length) flags &= ~zmq.ZMQ_POLLOUT;
      if (!flags) break;

      if (flags & zmq.ZMQ_POLLIN) {
          emitArgs = ['message'];

          do {
            emitArgs.push(new Buffer(this._zmq.recv()));
          } while (this._receiveMore);

          // Allows flush to complete before handling received messages.
          (function(emitArgs) {
            process.nextTick(function(){
              self.emit.apply(self, emitArgs);
            })
          })(emitArgs);

          if (zmq.STATE_READY != this._zmq.state) {
            this._flushing = false;
            return;
          }
      }

      // We send as much as possible in one burst so that we don't
      // starve sends if we receive more than one message for each
      // one sent.
      while (flags & zmq.ZMQ_POLLOUT && this._outgoing.length) {
        args = this._outgoing.shift();
        this._zmq.send(args[0], args[1]);
        flags = this._ioevents;
      }
    }
  } catch (err) {
    this.emit('error', err);
  }

  this._flushing = false;
};

/**
 * Close the socket.
 *
 * @return {Socket} for chaining
 * @api public
 */

Socket.prototype.close = function() {
  this._zmq.close();
  return this;
};

/**
 * Create a `type` socket with the given `options`.
 *
 * @param {String} type
 * @param {Object} options
 * @return {Socket}
 * @api public
 */

exports.socket =
exports.createSocket = function(type, options) {
  var sock = new Socket(type);
  for (var key in options) sock[key] = options[key];
  return sock;
};
