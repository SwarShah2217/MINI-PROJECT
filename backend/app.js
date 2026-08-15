//starts backend
const DiscoveryService = require("./src/discovery/discoveryService");

// Import the TCP server
const TCPServer = require("./src/connection/tcpServer");

// Import the outgoing TCP connection manager
const ConnectionManager = require("./src/connection/connectionManager");

const ConnectionState =
    require("./src/connection/connectionState");

const TransferManager =
    require("./src/transfer/transferManager");

// Import the local web interface server
const WebServer = require("./src/web/webServer");

const FileTransferServer =
    require("./src/transfer/fileTransferServer");

// Create UDP discovery service
const discoveryService = new DiscoveryService();

// Shared state used by incoming and outgoing TCP connections
const connectionState =
    new ConnectionState();

const transferManager =
    new TransferManager(connectionState);

// Create the TCP server instance
const tcpServer =
    new TCPServer(connectionState);

// Create the outgoing TCP connection manager

const connectionManager =
    new ConnectionManager(
        connectionState,
        transferManager
    );

// Give the web server access to TCP connections and discovered devices
const webServer =
    new WebServer(tcpServer, discoveryService, connectionManager, transferManager);

const fileTransferServer =
    new FileTransferServer();

// Start UDP device discovery.
discoveryService.start();

// Start listening for incoming TCP connections
tcpServer.start();

// Start the local web interface
webServer.start();

fileTransferServer.start();