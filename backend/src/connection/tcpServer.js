const net = require("net");

const { TCP_PORT } = require("../config");

class TCPServer {
    constructor() {
        this.server = net.createServer((socket) => {
            this.handleConnection(socket);
        });

        // No connection request is pending when the server starts
        this.pendingSocket = null;
    }

    start() {
        this.server.listen(TCP_PORT, "0.0.0.0", () => {
            console.log(`TCP server listening on port ${TCP_PORT}`);
        });
    }

    handleConnection(socket) {
        console.log(
            `TCP connection received from ${socket.remoteAddress}:${socket.remotePort}`
        );

        socket.on("data", (data) => {
        try {
            const message = JSON.parse(data.toString());

            if (message.type === "CONNECTION_REQUEST") {
                console.log("Connection request received");

                // Store the pending connection request until it is accepted or rejected
                this.pendingSocket = socket;
            }

        } catch (error) {
            console.error("Invalid TCP message:", error.message);
            }   
        });

        socket.on("end", () => {
            console.log("TCP client disconnected");
        });

        socket.on("error", (error) => {
            console.error("TCP socket error:", error.message);
        });
    }

    acceptConnection() {
        if (!this.pendingSocket) {
            console.log("No pending connection request");
            return;
        }

        const response = {
            type: "CONNECTION_ACCEPTED"
        };

        this.pendingSocket.write(JSON.stringify(response));

        console.log("Connection accepted");

        this.pendingSocket = null;
    }

    rejectConnection() {
        if (!this.pendingSocket) {
            console.log("No pending connection request");
            return;
        }

        const response = {
            type: "CONNECTION_REJECTED"
        };

        this.pendingSocket.write(JSON.stringify(response));

        console.log("Connection rejected");

        this.pendingSocket.end();

        this.pendingSocket = null;
    }
}

module.exports = TCPServer;