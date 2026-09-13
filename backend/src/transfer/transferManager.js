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
            filePath: filePath,
            status: "pending"
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
        if (!this.pendingFile) return;

        this.pendingFile.status = "transferring";
        this.fileSocket = fileSocket;
        this.isPaused = false;
        
        // State variables for manual chunking
        this.offset = 0;
        this.chunkSize = 64 * 1024; // Send in 64 KB chunks

        console.log(`Starting file transfer: ${this.pendingFile.fileName}`);

        // Send file metadata header first
        const header = JSON.stringify({
            fileName: this.pendingFile.fileName,
            fileSize: this.pendingFile.fileSize
        }) + "\n";

        fileSocket.write(header);
        console.log("File transfer header sent");

        // Open the file manually rather than piping it
        fs.open(this.pendingFile.filePath, 'r', (error, fd) => {
            if (error) {
                console.error("Error opening file:", error.message);
                fileSocket.destroy();
                return;
            }
            
            this.fileDescriptor = fd;
            this.sendNextChunk(); // Kick off the chunk loop
        });
    }

    sendNextChunk() {
        // If user paused, break the loop and stop reading
        if (this.isPaused || !this.fileSocket) return;

        const buffer = Buffer.alloc(this.chunkSize);

        // Read exactly one chunk of data starting from our current offset
        fs.read(this.fileDescriptor, buffer, 0, this.chunkSize, this.offset, (error, bytesRead) => {
            if (error) {
                console.error("Error reading file chunk:", error.message);
                this.fileSocket.destroy();
                return;
            }

            // 0 bytes read means we hit the end of the file
            if (bytesRead === 0) {
                console.log("All chunks sent. Waiting for receiver confirmation...");
                fs.close(this.fileDescriptor, () => {});
                return;
            }

            // Extract only the data we actually read, update our position marker
            const dataToSend = buffer.subarray(0, bytesRead);
            this.offset += bytesRead;

            // Write to the TCP socket
            const canWriteMore = this.fileSocket.write(dataToSend);

            if (canWriteMore) {
                // Buffer has room, instantly send the next chunk
                this.sendNextChunk();
            } else {
                // TCP buffer is full, wait for it to clear ('drain') before sending next
                this.fileSocket.once('drain', () => {
                    this.sendNextChunk();
                });
            }
        });
    }

    pauseTransfer() {
        if (!this.isPaused && this.fileSocket) {
            this.isPaused = true;
            this.pendingFile.status = "paused";
            console.log("Transfer paused at offset:", this.offset);
            return true;
        }
        return false;
    }

    resumeTransfer() {
        if (this.isPaused && this.fileSocket) {
            this.isPaused = false;
            this.pendingFile.status = "transferring";
            console.log("Transfer resumed from offset:", this.offset);
            
            // Kickstart the loop again
            this.sendNextChunk();
            return true;
        }
        return false;
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