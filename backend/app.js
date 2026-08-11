//starts backend

const DiscoveryService = require("./src/discovery/discoveryService");

// Create the discovery service.
const discoveryService = new DiscoveryService();

// Start UDP device discovery.
discoveryService.start();