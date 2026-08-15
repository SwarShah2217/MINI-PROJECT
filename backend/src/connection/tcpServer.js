const net = require("net");

const { TCP_PORT } = require("../config");

class TCPServer {

    constructor(connectionState) {

        // Shared connection state
        this.connectionState = connectionState;

        this.server = net.createServer((socket) => {
            this.handleConnection(socket);
        });

        // No incoming request initially
        this.pendingSocket = null;
    }


    start() {

        this.server.listen(TCP_PORT, "0.0.0.0", () => {
            console.log(`TCP server listening on port ${TCP_PORT}`);
        });
    }


    handleConnection(socket) {

        const peerIp =
            socket.remoteAddress?.replace("::ffff:", "");

        console.log(
            `TCP connection received from ${peerIp}:${socket.remotePort}`
        );


        socket.on("data", (data) => {

            try {

                const message = JSON.parse(data.toString());


                if (message.type === "CONNECTION_REQUEST") {

                    // Only one connection/request is allowed at a time
                    if (this.connectionState.status !== "disconnected") {

                        socket.write(
                            JSON.stringify({
                                type: "CONNECTION_REJECTED"
                            })
                        );

                        socket.end();

                        return;
                    }


                    console.log("Connection request received");

                    // Store incoming request
                    this.pendingSocket = socket;

                    // Mark this device as having a pending request
                    this.connectionState.setPending(
                        peerIp,
                        socket
                    );
                }

            } catch (error) {

                console.error(
                    "Invalid TCP message:",
                    error.message
                );
            }
        });


        socket.on("end", () => {
            console.log("TCP client disconnected");
        });


        socket.on("close", () => {

            // Remove stale pending socket
            if (this.pendingSocket === socket) {
                this.pendingSocket = null;
            }

            // Reset state if this socket belonged to our current peer
            if (this.connectionState.peerIp === peerIp) {

                console.log("Peer connection closed");

                this.connectionState.reset();
            }
        });


        socket.on("error", (error) => {

            console.error(
                "TCP socket error:",
                error.message
            );
        });
    }


    acceptConnection() {

        if (!this.pendingSocket) {
            console.log("No pending connection request");
            return false;
        }


        const socket = this.pendingSocket;

        const peerIp =
            socket.remoteAddress.replace("::ffff:", "");


        socket.write(
            JSON.stringify({
                type: "CONNECTION_ACCEPTED"
            })
        );


        // Receiver is now connected
        this.connectionState.setConnected(
            peerIp,
            socket
        );


        this.pendingSocket = null;

        console.log(`Connection accepted: ${peerIp}`);

        return true;
    }


    rejectConnection() {

        if (!this.pendingSocket) {
            console.log("No pending connection request");
            return false;
        }


        const socket = this.pendingSocket;

        socket.write(
            JSON.stringify({
                type: "CONNECTION_REJECTED"
            })
        );


        this.pendingSocket = null;

        // Return receiver to disconnected state
        this.connectionState.reset();

        socket.end();

        console.log("Connection rejected");

        return true;
    }
}

module.exports = TCPServer;