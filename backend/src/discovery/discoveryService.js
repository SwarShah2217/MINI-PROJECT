// Create socket
//      ↓
// Bind port
//      ↓
// Listen for messages
//      ↓
// Broadcast DISCOVER
//      ↓
// Send responses



const dgram = require("dgram");
const os = require("os");

const DeviceRegistry = require("./deviceRegistry");

const {
    DISCOVERY_PORT,
    DISCOVERY_INTERVAL,
    BROADCAST_ADDRESS
} = require("../config");  //taken from config.js


class DiscoveryService {
    constructor() {

        // Create a UDP socket.
        // "udp4" means we are using IPv4.
        this.socket = dgram.createSocket("udp4");

        // Get this laptop's name.
        // Example: "Swar-Laptop"
        this.deviceName = os.hostname();

        this.deviceRegistry = new DeviceRegistry();
        // existing event handlers remain here

         // Remove devices that have not responded recently
        this.cleanupInterval = setInterval(() => {
        this.deviceRegistry.removeStaleDevices();
        }, 5000);


        // Set up what should happen when
        // the socket receives a message.
        this.socket.on("message", (message, remoteInfo) => {
            this.handleMessage(message, remoteInfo);
        });

        // Handle any UDP socket errors.
        this.socket.on("error", (error) => {
            console.error("UDP Socket Error:", error);
        });

        // This event happens after socket.bind()
        // successfully starts listening.
        this.socket.on("listening", () => {
            const address = this.socket.address();
            console.log(
                `Listening for discovery on UDP port ${address.port}`
            );
        });
    }

    start() {
        // Start listening on UDP port 41234.
        this.socket.bind(DISCOVERY_PORT, () => {

            // Allow this socket to send broadcast messages.
            this.socket.setBroadcast(true);

            console.log("Discovery service started.");

            // Start sending DISCOVER messages.
            this.startBroadcasting();
        });
    }


    startBroadcasting() {

        // Send the first DISCOVER immediately.
        this.sendDiscover();

        // Then send DISCOVER every 5 seconds.
        setInterval(() => {
            this.sendDiscover();
        }, DISCOVERY_INTERVAL);
    }

    sendDiscover() {

        // The actual message we are broadcasting.
        const message = Buffer.from("DISCOVER");

        this.socket.send(
            message,

            // UDP destination port
            DISCOVERY_PORT,

            // Broadcast to all devices on the LAN
            BROADCAST_ADDRESS,

            (error) => {
                if (error) {
                    console.error(
                        "Error sending DISCOVER:",
                        error
                    );
                } else {
                    console.log("Sent: DISCOVER");
                }
            }
        );
    }


    handleMessage(message, remoteInfo) {

        // Ignore messages coming from this same laptop.
        // Otherwise, our own broadcast will look like
        // another device's DISCOVER message.
        if (remoteInfo.address === this.getLocalIPAddress()) {
            return;
        }

        // Convert the received Buffer into normal text.
        const messageText = message.toString();

        console.log(
            `Received "${messageText}" from ${remoteInfo.address}`
        );

        // If another laptop is asking:
        // "Are there any SyncLAN devices here?"
        if (messageText === "DISCOVER") {
            this.sendDiscoveryResponse(remoteInfo);
            return;
        }

        // If we receive something other than DISCOVER,
        // try to interpret it as JSON.
        try {
            const data = JSON.parse(messageText);

            // Check whether this is a discovery response.
            if (data.type === "DISCOVER_RESPONSE") {
                this.handleDiscoveryResponse(data, remoteInfo);
            }
        } catch (error) {
            // The message wasn't valid JSON.
            console.log("Received unknown message.");
        }
    }

    sendDiscoveryResponse(remoteInfo) {

        // Information about this laptop.
        const response = {

            type: "DISCOVER_RESPONSE",

            // Example:
            // "DESKTOP-ABC123"
            deviceName: this.deviceName,

            // remoteInfo gives us information about
            // the laptop that sent DISCOVER.
            //
            // But we need OUR IP address here.
            ip: this.getLocalIPAddress()
        };


        // Convert JavaScript object → JSON string → Buffer
        const message = Buffer.from(
            JSON.stringify(response)
        );


        // Send the response directly back to
        // the laptop that sent DISCOVER.
        this.socket.send(
            message,
            DISCOVERY_PORT,
            remoteInfo.address,
            (error) => {

                if (error) {
                    console.error(
                        "Error sending response:",
                        error
                    );
                } else {
                    console.log(
                        `Sent DISCOVER_RESPONSE to ${remoteInfo.address}`
                    );
                }
            }
        );
    }

    handleDiscoveryResponse(data, remoteInfo) {

    this.deviceRegistry.addOrUpdateDevice({
        deviceName: data.deviceName,
        ip: remoteInfo.address
    });

    console.log(
        `Discovered device: ${data.deviceName} (${remoteInfo.address})`
    );

    console.log("Active devices:");
    console.table(this.deviceRegistry.getDevices());
}


    getLocalIPAddress() {

        // Get all network interfaces of this laptop.
        const interfaces = os.networkInterfaces();

        // Check each network interface.
        for (const interfaceName of Object.keys(interfaces)) {
            for (const network of interfaces[interfaceName]) {

                // We only want:
                // IPv4 addresses
                // that are not localhost/internal addresses.
                if (
                    network.family === "IPv4" &&
                    !network.internal
                ) {
                    return network.address;
                }
            }
        }

        // If no suitable IP was found.
        return "unknown";
    }
}

module.exports = DiscoveryService;