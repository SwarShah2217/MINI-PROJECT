const net = require("net");

const { TCP_PORT } = require("../config");

class TCPServer {
    constructor() {
        this.server = net.createServer((socket) => {
            this.handleConnection(socket);
        });
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

                // Temporary auto-accept for testing
                const response = {
                type: "CONNECTION_ACCEPTED"
                };

               socket.write(JSON.stringify(response));
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
}

module.exports = TCPServer;