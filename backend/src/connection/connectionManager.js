const net = require("net");

const { TCP_PORT } = require("../config");

class ConnectionManager {
    connectToDevice(ip) {
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
                console.log("Connection accepted by peer");
            }

            if (message.type === "CONNECTION_REJECTED") {
                console.log("Connection rejected by peer");
                socket.end();
            }

            } catch (error) {
                console.error("Invalid TCP response:", error.message);
                }
        });

        socket.on("error", (error) => {
            console.error(
                `Connection error with ${ip}:`,
                error.message
            );
        });

        socket.on("close", () => {
            console.log(`Connection closed with ${ip}`);
        });

        return socket;
    }
}

module.exports = ConnectionManager;