#!/usr/bin/env node

// Import libraries
var args = require("optimist").argv;
var cluster = require("cluster");
var http = require("http");
var https = require("https");
var fs = require("fs");
var ws = require("ws");
var net = require("net");
var util = require("util");
var format = util.format;

// Allowed IP:HOST to proxy to.
// Initialize allowed array from args or default empty (allow all)
var allowed = [];
if (args.a || args.allow) {
  allowed = (args.a || args.allow).split(",");
}

// Message module
var Mes = {
  info: function Info() {
    var mes = format.apply(null, this.wrap(arguments));
    console.log("\x1b[1;37m[%s]:\x1b[0m %s", "Info", mes);
  },
  status: function Status() {
    var mes = format.apply(null, this.wrap(arguments));
    console.log("\x1b[1;32m[%s]:\x1b[0m %s", "Status", mes);
  },
  error: function Error() {
    var mes = format.apply(null, this.wrap(arguments));
    console.log("\x1b[1;31m[%s]:\x1b[0m %s", "Error", mes);
  },
  warn: function Warning() {
    var mes = format.apply(null, this.wrap(arguments));
    console.log("\x1b[1;33m[%s]:\x1b[0m %s", "Warn", mes);
  },
  wrap: function Wrap() {
    var args = [];
    args.push(arguments[0][0]);
    for (var i = 1; i < arguments[0].length; i++) {
      args.push("\x1b[1;37m" + arguments[0][i] + "\x1b[0m");
    }
    return args;
  },
};

// Modules manager
var Modules = {
  stack: {
    verify: [],
    connect: [],
  },
  load: function registerModule(folder) {
    // Load built-in allow module (defined below)
    if (folder === "allow") {
      Modules.stack.verify.push(allowModule.verify);
    }
  },
  run: function runModule(method, index, _arguments, next) {
    if (this.stack[method].length <= index) {
      next();
      return;
    }
    _arguments.push(next);
    this.stack[method][index].apply(null, _arguments);
  },
  method: {},
};

// Verify modules
Modules.method.verify = function Verify(info, callback) {
  var next = 0;
  var fnc = function () {
    Modules.run("verify", next, [info], function (bool) {
      if (bool === false) {
        callback(false);
        return;
      }
      if (next >= Modules.stack["verify"].length) {
        callback(true);
        return;
      }
      next++;
      fnc();
    });
  };
  fnc();
};

// Connect modules
Modules.method.connect = function Connect(ws, callback) {
  var next = 0;
  var fnc = function () {
    Modules.run("connect", next, [ws], function () {
      if (next >= Modules.stack["connect"].length) {
        callback();
        return;
      }
      next++;
      fnc();
    });
  };
  fnc();
};

// Allow module logic (replacing need for allowed.js)
var allowModule = {
  verify: function checkAllowed(info, next) {
    var target = info.req.url.substr(1);
    var from = info.req.connection.remoteAddress;

    if (allowed.length && allowed.indexOf(target) < 0) {
      Mes.info("Reject requested connection from '%s' to '%s'.", from, target);
      next(false);
      return;
    }
    next(true);
  },
};

// Proxy constructor
var Proxy = function Constructor(ws) {
  const to = ws.upgradeReq.url.substr(1);
  this._tcp;
  this._from = ws.upgradeReq.connection.remoteAddress;
  this._to = Buffer.from(to, "base64").toString();
  this._ws = ws;

  // Bind data
  this._ws.on("message", this.clientData.bind(this));
  this._ws.on("close", this.close.bind(this));
  this._ws.on("error", (error) => {
    console.log(error);
  });

  // Initialize proxy
  var args = this._to.split(":");
  Mes.info(
    "Requested connection from '%s' to '%s' [ACCEPTED].",
    this._from,
    this._to
  );
  this._tcp = net.connect(args[1], args[0]);

  // Disable nagle algorithm
  this._tcp.setTimeout(0);
  this._tcp.setNoDelay(true);

  this._tcp.on("data", this.serverData.bind(this));
  this._tcp.on("close", this.close.bind(this));
  this._tcp.on("error", function (error) {
    console.log(error);
  });

  this._tcp.on("connect", this.connectAccept.bind(this));
};

// Client data handling
Proxy.prototype.clientData = function OnServerData(data) {
  if (!this._tcp) {
    return;
  }
  try {
    this._tcp.write(data);
  } catch (e) {}
};

// Server data handling
Proxy.prototype.serverData = function OnClientData(data) {
  this._ws.send(data.toString(), function (error) {});
};

// Close connections
Proxy.prototype.close = function OnClose() {
  if (this._tcp) {
    this._tcp.removeListener("close", this.close.bind(this));
    this._tcp.removeListener("error", this.close.bind(this));
    this._tcp.removeListener("data", this.serverData.bind(this));
    this._tcp.end();
  }
  if (this._ws) {
    this._ws.removeListener("close", this.close.bind(this));
    this._ws.removeListener("error", this.close.bind(this));
    this._ws.removeListener("message", this.clientData.bind(this));
    this._ws.close();
  }
};

// On server accepts connection
Proxy.prototype.connectAccept = function OnConnectAccept() {
  Mes.status("Connection accepted from '%s'.", this._to);
};

// Load allow module
Modules.load("allow");

// Main function
function main(config) {
  var opts = {
    clientTracking: false,
    verifyClient: onRequestConnect,
  };

  // Create HTTP server
  opts.server = http.createServer(function (req, res) {
    res.writeHead(200);
    res.end("wsProxy running...\n");
  });

  opts.server.listen(config.port);
  Mes.status("Starting wsProxy on port %s...", config.port);

  var WebSocketServer = new ws.Server(opts);
  WebSocketServer.on("connection", onConnection);
}

// Before establishing a connection
function onRequestConnect(info, callback) {
  Modules.method.verify(info, function (res) {
    callback(res);
  });
}

// Connection passed through verify, lets initiate a proxy
function onConnection(ws) {
  Modules.method.connect(ws, function (res) {
    new Proxy(ws);
  });
}

// Init
main({
  port: process.env.PORT || 5999,
  workers: 2,
  ssl: false,
});
