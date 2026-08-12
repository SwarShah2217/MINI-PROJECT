//store settings like port etc


// UDP port used by SyncLAN for device discovery
const DISCOVERY_PORT = 41234;

// Send DISCOVER message every 5 seconds
const DISCOVERY_INTERVAL = 5000;

// Broadcast address means:
// "Send this message to all devices on my local network"
const BROADCAST_ADDRESS = "255.255.255.255";

// TCP port used for peer-to-peer connections and file transfers
const TCP_PORT = 5000;

module.exports = {
    DISCOVERY_PORT,
    DISCOVERY_INTERVAL,
    BROADCAST_ADDRESS,
    TCP_PORT
};