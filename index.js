// "Class" implementation for HTTPServer using prototypical inheritance
const http = require('http');
const https = require('https');
const net = require('net');

const fs = require('fs'); // For HTTPS key/cert

const { ProtocolServer, ProtocolClient } = require('../index.js'); // Adjust the path if needed

// HTTP Server (Function Implementation)
function HTTPServer() {
  ProtocolServer.call(this, 'HTTP');
  this.server = null;
  this.config = {};
}

// Inherit prototype methods from ProtocolServer
HTTPServer.prototype = Object.create(ProtocolServer.prototype);
HTTPServer.prototype.constructor = HTTPServer;

HTTPServer.prototype.init = async function (config) {
  await ProtocolServer.prototype.init.call(this, config);
  this.config = config;
};

HTTPServer.prototype.listen = async function (port, address = '0.0.0.0') {
  const self = this;
  await ProtocolServer.prototype.listen.call(this, port, address);

  return new Promise((resolve, reject) => {
    const serverCallback = (req, res) => {
      let data = '';
      req.on('data', (chunk) => {
        data += chunk;
      });
      req.on('end', async () => {
        try {
          // Call the event handlers.
          self.handleConnection(req.socket); //maps to connect
          self.call('receive', req.socket, data); //maps to receive
          const responseData = await self.processMessage(req.socket, data, { req, res }); // Include req and res
          if (responseData !== undefined) {
            self.call('respond', req.socket, responseData, { req, res });
            if (typeof responseData === 'string') {
              res.end(responseData);
            }
            // else assume that the processMessage handler has handled the response
          }
        } catch (error) {
          console.error("error in request", error)
          res.statusCode = 500;
          res.end('Internal Server Error');
          self.call('error', error, 'requestHandler', req, res); //emit error
        }
      });
      req.on('error', (err) => {
        console.error("request error", err);
        self.call('error', err, 'requestError', req, res);
      })
    };

    if (this.config.ssl) {
      try {
        const sslOptions = {
          key: fs.readFileSync(this.config.ssl.key),
          cert: fs.readFileSync(this.config.ssl.cert),
          // Add other SSL options as needed (e.g., ca, passphrase)
        };
        self.server = https.createServer(sslOptions, serverCallback).listen(port, address, () => {
          console.log(`HTTPS server listening on ${address}:${port}`);
          resolve();
        });
      } catch (error) {
        console.error("Error setting up https", error);
        reject(error);
      }

    } else {
      self.server = http.createServer(serverCallback).listen(port, address, () => {
        console.log(`HTTP server listening on ${address}:${port}`);
        resolve();
      });
    }


    self.server.on('error', (err) => {
      console.error('HTTP(S) server error:', err);
      self.call('error', err, 'listen');
      reject(err);
    });
  });
};

HTTPServer.prototype.shutdown = async function () {
  await ProtocolServer.prototype.shutdown.call(this);
  const self = this;
  return new Promise((resolve) => {
    if (self.server) {
      self.server.close(() => {
        console.log('HTTP(S) server closed.');
        resolve();
      });
    } else {
      resolve();
    }
  });
};

// Example Usage:
async function runServers(callbacks, port, ipaddress, config) {
  // HTTP Server Example
  const httpServer = new HTTPServer();

  httpServer.on('init', callbacks["init"] || function (config) {
    console.log('HTTP Server initialized with config:', config);
  });

  httpServer.on('connect', callbacks["connect"] || function (socket) {
    console.log('HTTP Client connected:', socket.remoteAddress + ':' + socket.remotePort);
  });

  httpServer.on('receive', callbacks["receive"] || function (socket, data) {
    console.log('HTTP Received:', data.toString().substring(0, 200)); //first 200 chars
  });

  httpServer.on('processMessage', callbacks["processMessage"] || async function (socket, data, { req, res }) {
    console.log('HTTP processing message:', data.toString().substring(0, 200));
    // You can access the req and res objects here
    res.setHeader('Content-Type', 'text/html');
    return '<h1>Hello, World!</h1><p>You sent: ' + data.toString().substring(0, 50) + '</p>';
  });

  httpServer.on('respond', callbacks["respond"] || function (socket, response, { req, res }) {
    console.log('HTTP sending response:', response.substring(0, 200));
  });

  httpServer.onError(callbacks["error"] || function (err, eventName, ...args) {
    console.error(`[HTTP Server] Error in event "${eventName}":`, err, ...args);
  });

  await httpServer.init(config || { some: 'http config' });
  await httpServer.listen(port || 3000, ipaddress || "localhost");

  console.log(`Servers are running at port ${port} and ${ipaddress}`);
}

// runServers();

// HTTP Client (function implementation using prototypical inheritance)
function HTTPClient(options = {}) {
  ProtocolClient.call(this, 'HTTP');
  this.options = {
    method: 'GET',
    ...options,
  };
}

HTTPClient.prototype = Object.create(ProtocolClient.prototype);
HTTPClient.prototype.constructor = HTTPClient;

HTTPClient.prototype._connectToServer = async function (serverAddress, serverPort) {
  // HTTP doesn't have a persistent connection at the socket level in the same way as TCP.
  // Each request is a new "connection" in a sense, though keep-alive can reuse underlying sockets.
  // We'll perform the request within the send method.
  return Promise.resolve(); // Resolve immediately as the connection is per-request
};

HTTPClient.prototype.send = async function (requestOptions = {}, requestBody) {
  const options = {
    ...this.options,
    ...requestOptions,
    hostname: this.options.hostname || requestOptions.hostname,
    port: this.options.port || requestOptions.port,
    path: this.options.path || requestOptions.path || '/',
    protocol: this.options.protocol || requestOptions.protocol || 'http:',
  };

  const protocol = options.protocol === 'https:' ? https : http;

  return new Promise((resolve, reject) => {
    const req = protocol.request(options, (res) => {
      this.connection = req.socket; // Store the socket for potential reuse (keep-alive)
      this.call('connect', req.socket); // Simulate connect event

      let responseData = '';
      res.on('data', (chunk) => {
        responseData += chunk;
        this.call('receive', req.socket, chunk);
      });

      res.on('end', () => {
        this.call('disconnect', req.socket); // Simulate disconnect event
        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          data: responseData,
        });
        this.connection = null;
      });

      res.on('error', (err) => {
        this.call('error', err, 'responseError', req.socket);
        reject(err);
        this.connection = null;
      });
    });

    req.on('error', (err) => {
      this.call('error', err, 'requestError', null);
      reject(err);
      this.connection = null;
    });

    this.call('send', null, { options, body: requestBody }); // No persistent connection yet

    if (requestBody) {
      req.write(requestBody);
    }
    req.end();
  });
};

HTTPClient.prototype.handshake = async function () {
  console.log('HTTP Client: No explicit handshake.');
  await this.call('handshake', this.connection);
};

HTTPClient.prototype.disconnect = async function () {
  console.log('HTTP Client: Disconnecting (ending request).');
  if (this.connection) {
    this.connection.end(); // Attempt to close the underlying socket (if keep-alive is not active)
    this.connection.destroy();
    this.connection = null;
    await this.call('disconnect', this.connection);
  } else {
    await this.call('disconnect', null);
  }
};

HTTPClient.prototype.sendRequest = async function (options, body) {
  return this.send(options, body);
};

// Example usage (same as before, but using the function implementations):
async function runClients(callbacks, config, data, options) {

  // // HTTP Client Example
  // const httpClient = new HTTPClient({
  //   hostname: 'jsonplaceholder.typicode.com',
  //   port: 443,
  //   protocol: 'https:',
  //   path: '/todos/1',
  //   method: 'GET',
  // });

  // httpClient.on('connect', callbacks["connect"] || function (socket) {
  //   console.log('HTTP Client: Socket connected.');
  // });

  // httpClient.on('send', callbacks["send"] || function (socket, message) {
  //   console.log('HTTP Client: Sending request:', message.options.method, message.options.path);
  //   if (message.body) {
  //     console.log('HTTP Client: Sending body:', message.body);
  //   }
  // });

  // httpClient.on('receive', callbacks["receive"] || function (socket, data) {
  //   // console.log('HTTP Client: Received data chunk:', data.toString());
  // });

  // httpClient.on('disconnect', callbacks["disconnect"] || function (socket) {
  //   console.log('HTTP Client: Socket disconnected.');
  // });

  // httpClient.onError(callbacks["error"] || function (err, eventName, ...args) {
  //   console.error(`[HTTP Client] Error in event "${eventName}":`, err, ...args);
  // });

  // try {
  //   const response = await httpClient.sendRequest();
  //   console.log('HTTP Client: Response Status Code:', response.statusCode);
  //   console.log('HTTP Client: Response Headers:', response.headers);
  //   console.log('HTTP Client: Response Data:', response.data);
  //   await httpClient.disconnect();
  // } catch (error) {
  //   console.error('HTTP Client request failed:', error);
  // }

  // Example POST request
  // const postClient = new HTTPClient(config || {
  //   hostname: 'jsonplaceholder.typicode.com',
  //   port: 443,
  //   protocol: 'https:',
  //   path: '/posts',
  //   method: 'POST',
  //   headers: {
  //     'Content-Type': 'application/json',
  //   },
  //   ...config
  // });

  const postClient = new HTTPClient(config || {
    port: 443,
    protocol: 'https:',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    ...config
  });

  httpClient.on('connect', callbacks["connect"] || function (socket) {
    console.log('HTTP Client: Socket connected.');
  });

  httpClient.on('send', callbacks["send"] || function (socket, message) {
    console.log('HTTP Client: Sending request:', message.options.method, message.options.path);
    if (message.body) {
      console.log('HTTP Client: Sending body:', message.body);
    }
  });

  httpClient.on('receive', callbacks["receive"] || function (socket, data) {
    // console.log('HTTP Client: Received data chunk:', data.toString());
  });

  httpClient.on('disconnect', callbacks["disconnect"] || function (socket) {
    console.log('HTTP Client: Socket disconnected.');
  });

  httpClient.onError(callbacks["error"] || function (err, eventName, ...args) {
    console.error(`[HTTP Client] Error in event "${eventName}":`, err, ...args);
  });

  try {
    // const postData = JSON.stringify(data || {
    //   title: 'foo',
    //   body: 'bar',
    //   userId: 1,
    // });
    const postData = JSON.stringify(data || {});
    const postResponse = await postClient.sendRequest(options || {}, postData);
    console.log('\nHTTP Client (POST) Response Status Code:', postResponse.statusCode);
    console.log('HTTP Client (POST) Response Data:', postResponse.data);
    await postClient.disconnect();
  } catch (error) {
    console.error('HTTP Client (POST) request failed:', error);
  }

}

// runClients();

module.exports = { HTTPClient, HTTPServer, runServers, runClients };


