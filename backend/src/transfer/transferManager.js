const net = require("net");
const fs = require("fs");
const path = require("path");

const {
    FILE_TRANSFER_PORT
} = require("../config");

class TransferManager {

    constructor(connectionState) {
        // Shared connection state gives access to the active TCP socket
        this.connectionState = connectionState;

        // Stores information about the file waiting to be transferred  
        this.pendingFile = null;
    }

    // Send file metadata to the connected peer
    sendTransferRequest(fileName, fileSize) {

        // File request can only be sent after connection is established
        if (this.connectionState.status !== "connected") {
            return false;
        }

        const socket = this.connectionState.socket;

        if (!socket) {
            return false;
        }

        // Location of the file temporarily uploaded by the browser
        const filePath = path.join(
            __dirname,
            "../../temp",
            fileName
        );

        // Make sure the file actually exists
        if (!fs.existsSync(filePath)) {

            console.error(
                `Temporary file not found: ${filePath}`
            );

            return false;
        }

        // Remember the file for when the receiver accepts it
        this.pendingFile = {
            fileName: fileName,
            fileSize: fileSize,
            filePath: filePath
        };

        const request = {
            type: "FILE_TRANSFER_REQUEST",
            fileName: fileName,
            fileSize: fileSize
        };

        socket.write(JSON.stringify(request));

        console.log(
            `File transfer request sent: ${fileName} (${fileSize} bytes)`
        );

        return true;
    }

    connectForFileTransfer(peerIp) {

        return new Promise((resolve, reject) => {

            const socket = net.createConnection(
                {
                    host: peerIp,
                    port: FILE_TRANSFER_PORT
                },
                () => {

                    console.log(
                        `File transfer connection established with ${peerIp}:${FILE_TRANSFER_PORT}`
                    );

                    resolve(socket);
                }
            );

            socket.on("data", (data) => {

                try {

                    const message =
                        JSON.parse(data.toString());

                    if (message.type === "FILE_TRANSFER_COMPLETE") {

                        console.log(
                            "Receiver confirmed file transfer is complete"
                        );

                        this.cleanupTemporaryFile();

                        socket.end();
                    }

                } catch (error) {

                    console.error(
                        "Invalid file transfer response:",
                        error.message
                    );
                }
            });

            socket.on("error", (error) => {

                console.error(
                    "File transfer connection error:",
                    error.message
                );

                reject(error);
            });


            socket.on("close", () => {

                console.log(
                    "File transfer connection closed"
                );
            });
        });
    }

    sendFile(fileSocket) {

        if (!this.pendingFile) {

            console.error(
                "No file is waiting to be transferred"
            );

            return;
        }

        const file = this.pendingFile;

        console.log(
            `Starting file transfer: ${file.fileName}`
        );

        // Send file information first
        const header = JSON.stringify({
            fileName: file.fileName,
            fileSize: file.fileSize
        }) + "\n";

        fileSocket.write(header);

        console.log(
            "File transfer header sent"
        );

        // Open the actual file
        const readStream =
            fs.createReadStream(file.filePath);

        readStream.on("error", (error) => {

            console.error(
                "Error reading file:",
                error.message
            );

            fileSocket.destroy();
        });

        readStream.on("end", () => {

            console.log(
                "File data sent successfully"
            );

            console.log(
                "Waiting for receiver confirmation..."
            );
        });

        // Send the actual file bytes
        readStream.pipe(fileSocket, { end: false });
    }

    cleanupTemporaryFile() {

        if (!this.pendingFile) {
            return;
        }

        fs.unlink(
            this.pendingFile.filePath,
            (error) => {

                if (error) {

                    console.error(
                        "Could not delete temporary file:",
                        error.message
                    );

                    return;
                }

                console.log(
                    `Temporary file deleted: ${this.pendingFile.filePath}`
                );

                this.pendingFile = null;
            }
        );
    }
}

module.exports = TransferManager;