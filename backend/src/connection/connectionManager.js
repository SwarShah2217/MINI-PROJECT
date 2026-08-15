const net = require("net");

const { TCP_PORT } = require("../config");

class ConnectionManager {

    constructor(connectionState) {
        // Shared connection state used by sender and receiver
        this.connectionState = connectionState;
    }

    connectToDevice(ip) {

        // Prevent duplicate connection requests
        if (this.connectionState.status !== "disconnected") {
            console.log("Already connected or connection request is pending");
            return;
        }

        // Mark connection as being attempted
        this.connectionState.setConnecting(ip);

        const socket = net.createConnection(
            {
                host: ip,
                port: TCP_PORT
            },
            () => {
                console.log(`Connected to ${ip}:${TCP_PORT}`);

                // Send a connection request to the selected device
                const request = {
                    type: "CONNECTION_REQUEST"
                };

                socket.write(JSON.stringify(request));
            }
        );


        socket.on("data", (data) => {

            try {

                const message = JSON.parse(data.toString());

                if (message.type === "CONNECTION_ACCEPTED") {

                    // Mark the connection as fully active
                    this.connectionState.setConnected(
                        ip,
                        socket
                    );

                    console.log("Connection accepted by peer");
                }


                if (message.type === "CONNECTION_REJECTED") {

                    console.log("Connection rejected by peer");

                    // Reset connection state
                    this.connectionState.reset();

                    socket.end();
                }

            } catch (error) {

                console.error(
                    "Invalid TCP response:",
                    error.message
                );
            }
        });


        socket.on("error", (error) => {

            console.error(
                `Connection error with ${ip}:`,
                error.message
            );

            // Reset if connection fails
            this.connectionState.reset();
        });


        socket.on("close", () => {

            console.log(`Connection closed with ${ip}`);

            // Reset state only if this was the active/pending peer
            if (this.connectionState.peerIp === ip) {
                this.connectionState.reset();
            }
        });


        return socket;
    }
}

module.exports = ConnectionManager;