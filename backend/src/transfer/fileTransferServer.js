const net = require("net");

const { FILE_TRANSFER_PORT } = require("../config");
const FileReceiver = require("./fileReceiver");

class FileTransferServer {

    constructor() {

        this.fileReceiver = new FileReceiver();

        this.server = net.createServer((socket) => {

            console.log(
                `File transfer connection received from ${socket.remoteAddress}:${socket.remotePort}`
            );

            let headerBuffer = Buffer.alloc(0);
            let headerReceived = false;

            socket.on("data", (data) => {

                // Wait until we receive the complete header
                if (!headerReceived) {

                    headerBuffer = Buffer.concat([
                        headerBuffer,
                        data
                    ]);

                    const newlineIndex =
                        headerBuffer.indexOf("\n");

                    // Header is not complete yet
                    if (newlineIndex === -1) {
                        return;
                    }

                    // Separate header from file bytes
                    const headerData =
                        headerBuffer.subarray(
                            0,
                            newlineIndex
                        );

                    const remainingData =
                        headerBuffer.subarray(
                            newlineIndex + 1
                        );

                    try {

                        const header =
                            JSON.parse(
                                headerData.toString()
                            );

                        console.log(
                            `Receiving file: ${header.fileName} (${header.fileSize} bytes)`
                        );

                        headerReceived = true;

                        // Stop the header parser from receiving
                        // any more file data.
                        socket.removeAllListeners("data");

                        // Start saving the file
                        this.fileReceiver.receiveFile(
                            socket,
                            header.fileName,
                            header.fileSize,
                            remainingData
                        );

                    } catch (error) {

                        console.error(
                            "Invalid file transfer header:",
                            error.message
                        );

                        socket.destroy();
                    }

                    return;
                }
            });

            socket.on("end", () => {

                console.log(
                    "File transfer connection closed"
                );
            });

            socket.on("error", (error) => {

                console.error(
                    "File transfer socket error:",
                    error.message
                );
            });
        });
    }

    start() {

        this.server.listen(
            FILE_TRANSFER_PORT,
            "0.0.0.0",
            () => {

                console.log(
                    `File transfer server listening on port ${FILE_TRANSFER_PORT}`
                );
            }
        );
    }
}

module.exports = FileTransferServer;