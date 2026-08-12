//starts backend

const DiscoveryService = require("./src/discovery/discoveryService");

// Import the TCP server
const TCPServer = require("./src/connection/tcpServer");

// Import the outgoing TCP connection manager
const ConnectionManager = require("./src/connection/connectionManager");

// Create the discovery service.
const discoveryService = new DiscoveryService();

// Create the TCP server instance
const tcpServer = new TCPServer();

// Create the outgoing TCP connection manager
const connectionManager = new ConnectionManager();

// Start UDP device discovery.
discoveryService.start();

// Start listening for incoming TCP connections
tcpServer.start();

