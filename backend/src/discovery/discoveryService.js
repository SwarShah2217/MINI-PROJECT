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
    DISCOVERY_INTERVAL
} = require("../config");


class DiscoveryService {

    constructor() {

        // Create a UDP socket.
        // "udp4" means we are using IPv4.
        this.socket = dgram.createSocket("udp4");

        // Get this laptop's hostname.
        this.deviceName = os.hostname();

        // Store discovered devices.
        this.deviceRegistry = new DeviceRegistry();

        // Remove devices that have not responded recently.
        this.cleanupInterval = setInterval(() => {
            this.deviceRegistry.removeStaleDevices();
        }, 5000);


        // -----------------------------------------
        // RECEIVE UDP MESSAGE
        // -----------------------------------------

        this.socket.on("message", (message, remoteInfo) => {
            this.handleMessage(message, remoteInfo);
        });


        // -----------------------------------------
        // SOCKET ERROR
        // -----------------------------------------

        this.socket.on("error", (error) => {
            console.error("UDP Socket Error:", error);
        });


        // -----------------------------------------
        // SOCKET LISTENING
        // -----------------------------------------

        this.socket.on("listening", () => {

            const address = this.socket.address();

            console.log(
                `Listening for discovery on UDP port ${address.port}`
            );
        });
    }


    // =========================================================
    // START DISCOVERY SERVICE
    // =========================================================

    start() {

        this.socket.bind(DISCOVERY_PORT, () => {

            // Allow UDP broadcast messages.
            this.socket.setBroadcast(true);

            console.log("Discovery service started.");

            console.log(
                "Local IP addresses:",
                this.getLocalIPAddresses()
            );

            console.log(
                "Broadcast addresses:",
                this.getBroadcastAddresses()
            );

            // Start sending DISCOVER messages.
            this.startBroadcasting();
        });
    }


    // =========================================================
    // CHECK WHETHER AN INTERFACE IS VIRTUAL
    // =========================================================

    isVirtualInterface(interfaceName, address) {

        const name = interfaceName.toLowerCase();

        const virtualInterfaceNames = [
            "virtualbox",
            "vbox",
            "vmware",
            "hyper-v",
            "hyperv",
            "vethernet",
            "wsl",
            "docker",
            "loopback"
        ];

        // Check interface name.
        for (const virtualName of virtualInterfaceNames) {

            if (name.includes(virtualName)) {
                return true;
            }
        }


        // VirtualBox default Host-Only network.
        if (address && address.startsWith("192.168.56.")) {
            return true;
        }


        // APIPA address.
        // Usually means the interface does not have
        // a proper LAN address.
        if (address && address.startsWith("169.254.")) {
            return true;
        }


        return false;
    }


    // =========================================================
    // GET LOCAL IP ADDRESSES
    // =========================================================

    getLocalIPAddresses() {

        const interfaces = os.networkInterfaces();

        const addresses = [];


        for (const [interfaceName, networks] of Object.entries(interfaces)) {

            for (const network of networks) {

                if (
                    network.family === "IPv4" &&
                    !network.internal &&
                    !this.isVirtualInterface(
                        interfaceName,
                        network.address
                    )
                ) {

                    addresses.push(network.address);
                }
            }
        }


        return addresses;
    }


    // =========================================================
    // GET PRIMARY LOCAL IP ADDRESS
    // =========================================================

    getLocalIPAddress() {

        const interfaces = os.networkInterfaces();


        for (const [interfaceName, networks] of Object.entries(interfaces)) {

            for (const network of networks) {

                if (
                    network.family === "IPv4" &&
                    !network.internal &&
                    !this.isVirtualInterface(
                        interfaceName,
                        network.address
                    )
                ) {

                    return network.address;
                }
            }
        }


        return "unknown";
    }


    // =========================================================
    // CALCULATE BROADCAST ADDRESS
    // =========================================================
    //
    // Example:
    //
    // IP:
    // 192.168.1.25
    //
    // Netmask:
    // 255.255.255.0
    //
    // Result:
    // 192.168.1.255
    //
    // =========================================================

    calculateBroadcastAddress(ip, netmask) {

        const ipParts = ip.split(".").map(Number);
        const maskParts = netmask.split(".").map(Number);


        const broadcastParts = ipParts.map((part, index) => {

            return part | (~maskParts[index] & 255);

        });


        return broadcastParts.join(".");
    }


    // =========================================================
    // GET BROADCAST ADDRESSES
    // =========================================================

    getBroadcastAddresses() {

        const interfaces = os.networkInterfaces();

        const broadcasts = [];


        for (const [interfaceName, networks] of Object.entries(interfaces)) {

            for (const network of networks) {

                // Ignore:
                // - IPv6
                // - localhost
                // - VirtualBox
                // - VMware
                // - Hyper-V
                // - WSL
                // - Docker
                // - APIPA
                if (
                    network.family !== "IPv4" ||
                    network.internal ||
                    this.isVirtualInterface(
                        interfaceName,
                        network.address
                    )
                ) {
                    continue;
                }


                // Some interfaces may not provide a netmask.
                if (!network.netmask) {
                    continue;
                }


                const broadcastAddress =
                    this.calculateBroadcastAddress(
                        network.address,
                        network.netmask
                    );


                broadcasts.push(broadcastAddress);


                console.log(
                    `Network interface: ${interfaceName}`
                );

                console.log(
                    `  IP: ${network.address}`
                );

                console.log(
                    `  Netmask: ${network.netmask}`
                );

                console.log(
                    `  Broadcast: ${broadcastAddress}`
                );
            }
        }


        // Remove duplicates.
        const uniqueBroadcasts = [
            ...new Set(broadcasts)
        ];


        // Fallback.
        //
        // Normally we should always have a real broadcast
        // address. This is only here as a safety net.
        if (uniqueBroadcasts.length === 0) {

            console.warn(
                "Could not determine LAN broadcast address."
            );

            return ["255.255.255.255"];
        }


        return uniqueBroadcasts;
    }


    // =========================================================
    // START BROADCASTING
    // =========================================================

    startBroadcasting() {

        // Send the first DISCOVER immediately.
        this.sendDiscover();


        // Continue sending DISCOVER messages periodically.
        this.broadcastInterval = setInterval(() => {

            this.sendDiscover();

        }, DISCOVERY_INTERVAL);
    }


    // =========================================================
    // SEND DISCOVER
    // =========================================================

    sendDiscover() {

        const message = Buffer.from("DISCOVER");


        // Get all valid LAN broadcast addresses.
        //
        // Example:
        //
        // [
        //     "192.168.1.255"
        // ]
        //
        const broadcastAddresses =
            this.getBroadcastAddresses();


        console.log(
            "Broadcasting DISCOVER to:",
            broadcastAddresses
        );


        for (const broadcastAddress of broadcastAddresses) {

            this.socket.send(
                message,
                0,
                message.length,
                DISCOVERY_PORT,
                broadcastAddress,
                (error) => {

                    if (error) {

                        console.error(
                            `Error sending DISCOVER to ${broadcastAddress}:`,
                            error
                        );

                    } else {

                        console.log(
                            `Sent DISCOVER to ${broadcastAddress}`
                        );
                    }
                }
            );
        }
    }


    // =========================================================
    // HANDLE RECEIVED MESSAGE
    // =========================================================

    handleMessage(message, remoteInfo) {

        // Get our own valid LAN IP addresses.
        const localAddresses =
            this.getLocalIPAddresses();


        // -----------------------------------------
        // IGNORE OUR OWN PACKETS
        // -----------------------------------------

        if (localAddresses.includes(remoteInfo.address)) {

            return;
        }


        // Convert Buffer -> String.
        const messageText = message.toString();


        console.log(
            `Received "${messageText}" from ${remoteInfo.address}`
        );


        // -----------------------------------------
        // DISCOVER REQUEST
        // -----------------------------------------

        if (messageText === "DISCOVER") {

            console.log(
                `DISCOVER received from ${remoteInfo.address}`
            );


            // Send our information directly back
            // to the device that sent DISCOVER.
            this.sendDiscoveryResponse(remoteInfo);


            return;
        }


        // -----------------------------------------
        // DISCOVERY RESPONSE
        // -----------------------------------------

        try {

            const data = JSON.parse(messageText);


            if (data.type === "DISCOVER_RESPONSE") {

                this.handleDiscoveryResponse(
                    data,
                    remoteInfo
                );
            }

        } catch (error) {

            console.log(
                "Received unknown message."
            );
        }
    }


    // =========================================================
    // SEND DISCOVERY RESPONSE
    // =========================================================

    sendDiscoveryResponse(remoteInfo) {

        const response = {

            type: "DISCOVER_RESPONSE",

            // Our computer's name.
            deviceName: this.deviceName,

            // Our actual LAN IP.
            ip: this.getLocalIPAddress()
        };


        // JavaScript object
        //       ↓
        // JSON string
        //       ↓
        // Buffer
        const message = Buffer.from(
            JSON.stringify(response)
        );


        console.log(
            `Sending DISCOVER_RESPONSE to ${remoteInfo.address}`
        );


        this.socket.send(
            message,
            0,
            message.length,
            DISCOVERY_PORT,
            remoteInfo.address,
            (error) => {

                if (error) {

                    console.error(
                        `Error sending response to ${remoteInfo.address}:`,
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


    // =========================================================
    // HANDLE DISCOVERY RESPONSE
    // =========================================================

    handleDiscoveryResponse(data, remoteInfo) {

        // IMPORTANT:
        //
        // Use remoteInfo.address rather than data.ip
        // because remoteInfo.address is the actual IP
        // from which the UDP packet arrived.
        //
        this.deviceRegistry.addOrUpdateDevice({

            deviceName: data.deviceName,

            ip: remoteInfo.address
        });


        console.log(
            `Discovered device: ${data.deviceName} (${remoteInfo.address})`
        );


        console.log("Active devices:");

        console.table(
            this.deviceRegistry.getDevices()
        );
    }


    // =========================================================
    // STOP DISCOVERY SERVICE
    // =========================================================

    stop() {

        console.log("Stopping discovery service...");


        if (this.broadcastInterval) {

            clearInterval(
                this.broadcastInterval
            );

            this.broadcastInterval = null;
        }


        if (this.cleanupInterval) {

            clearInterval(
                this.cleanupInterval
            );

            this.cleanupInterval = null;
        }


        if (this.socket) {

            this.socket.close(() => {

                console.log(
                    "Discovery socket closed."
                );

            });
        }
    }
}


module.exports = DiscoveryService;
