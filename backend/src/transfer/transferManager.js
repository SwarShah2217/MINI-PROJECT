const net = require("net");
const fs = require("fs");
const path = require("path");
const HashService = require("../integrity/hashService");
const ChunkProtocol = require("./chunkProtocol");
const EncryptionService =
    require("../security/encryptionService");

const CompressionService =
    require("../compression/compressionService");

const SessionKeyManager =
    require("../security/sessionKeyManager");

const KeyExchangeService =
    require("../security/keyExchangeService");

const {
    FILE_TRANSFER_PORT
} = require("../config");

class TransferManager {

    constructor(connectionState) {
        // Shared connection state gives access to the active TCP socket
        this.connectionState = connectionState;

        // Stores a queue of files waiting to be transferred
        this.transferQueue = [];
        this.activeTransfer = null;
        this.sessionKeyManager =
            new SessionKeyManager();

        this.keyExchanges = new Map();
    }

    // Send file metadata to the connected peer
    sendTransferRequest(fileName, fileSize, transferId) {

        // File request can only be sent after connection is established
        if (this.connectionState.status !== "connected") {
            return false;
        }

        const socket = this.connectionState.socket;

        if (!socket) {
            return false;
        }

        // Location of the file temporarily uploaded by the browser
        const tempFileName = `${transferId}-${fileName}`;
        const filePath = path.join(
            __dirname,
            "../../temp",
            tempFileName
        );

        // Make sure the file actually exists
        if (!fs.existsSync(filePath)) {

            console.error(
                `Temporary file not found: ${filePath}`
            );

            return false;
        }

        // Add the file to the queue
        this.transferQueue.push({
            fileName: fileName,
            fileSize: fileSize,
            transferId: transferId,
            filePath: filePath,
            status: "queued"
        });

        // Trigger processing if idle
        if (!this.activeTransfer) {
            this.processQueue();
        }

        console.log(
            `File added to transfer queue: ${fileName} (${fileSize} bytes)`
        );

        return true;
    }

    // Process the next file in the queue
    processQueue() {
        if (this.activeTransfer || this.transferQueue.length === 0) {
            return;
        }

        const socket = this.connectionState.socket;
        if (!socket || this.connectionState.status !== "connected") {
            return;
        }

        this.activeTransfer = this.transferQueue.shift();
        this.activeTransfer.status = "pending";

        const keyExchange =
            KeyExchangeService.createKeyPair();

        this.keyExchanges.set(
            this.activeTransfer.transferId,
            keyExchange.ecdh
        );

        const request = {
            type: "FILE_TRANSFER_REQUEST",
            fileName: this.activeTransfer.fileName,
            fileSize: this.activeTransfer.fileSize,
            transferId: this.activeTransfer.transferId,
            publicKey: keyExchange.publicKey
        };

        socket.write(
            JSON.stringify(request) +
            "\n"
        );

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

            let responseBuffer = "";

socket.on("data", (data) => {

    responseBuffer += data.toString("utf8");

    let newlineIndex;

    while (
        (newlineIndex = responseBuffer.indexOf("\n")) !== -1
    ) {

        const messageText =
            responseBuffer
                .slice(0, newlineIndex)
                .trim();

        responseBuffer =
            responseBuffer.slice(
                newlineIndex + 1
            );

        if (!messageText) {
            continue;
        }

        let message;

        try {

            message =
                JSON.parse(messageText);

        } catch (error) {

            console.error(
                "Invalid file transfer response:",
                messageText
            );

            continue;
        }


        if (
            message.type ===
            "CHUNK_ACK"
        ) {

            console.log(
                `ACK received for chunk ${message.chunkNumber}`
            );

            continue;
        }


        if (
            message.type ===
            "CHUNK_NACK"
        ) {

            console.log(
                `NACK received for chunk ${message.chunkNumber}`
            );

            this.resendChunk(
                message.chunkNumber
            );

            continue;
        }

        if (
            message.type ===
            "FILE_INTEGRITY_FAILED"
        ) {

            console.error(
                "Receiver reported FINAL FILE SHA-256 FAILURE"
            );

            socket.end();

            continue;
        }


        if (
            message.type ===
            "FILE_TRANSFER_COMPLETE"
        ) {

            console.log(
                "Receiver confirmed file transfer is complete"
            );

            this.cleanupTemporaryFile();

            socket.end();
        }
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
        if (!this.activeTransfer) return;

        this.activeTransfer.status = "transferring";
        this.fileSocket = fileSocket;
        this.isPaused = false;
        
        // State variables for manual chunking
        this.offset = 0;
        this.chunkSize = 64 * 1024; // Send in 64 KB chunks
        this.chunkNumber = 0;

        this.encryptionKey =
            this.sessionKeyManager.getSessionKey(
                this.activeTransfer.transferId
            );


        if (!this.encryptionKey) {

            console.error(
                "No session encryption key available"
            );

            fileSocket.destroy();
            return;
        }
                
        console.log(`Starting file transfer: ${this.activeTransfer.fileName}`);

        // Calculate complete file SHA-256 before transfer
        HashService.hashFile(
            this.activeTransfer.filePath
        )
        .then((fileHash) => {

            this.activeTransfer.fileHash =
                fileHash;

            console.log(
                `Complete file SHA-256: ${fileHash}`
            );


            // Send file metadata header
            const header =
                JSON.stringify({
                    fileName:
                        this.activeTransfer.fileName,

                    fileSize:
                        this.activeTransfer.fileSize,

                    transferId:
                        this.activeTransfer.transferId,

                    fileHash:
                        fileHash

                }) + "\n";


            fileSocket.write(header);

            console.log(
                "File transfer header sent"
            );


            // Open file after hash is ready
            fs.open(
                this.activeTransfer.filePath,
                "r",
                (error, fd) => {
                    if (error) {
                        console.error(
                            "Error opening file:",
                            error.message
                        );

                        fileSocket.destroy();
                        return;
                    }

                    this.fileDescriptor = fd;
                    this.sendNextChunk();
                }
            );

        })
        .catch((error) => {

            console.error(
                "Could not calculate complete file SHA-256:",
                error.message
            );

            fileSocket.destroy();
        });

    }

    sendNextChunk() {

        if (this.isPaused || !this.fileSocket) {
            return;
        }

        const buffer =
            Buffer.alloc(this.chunkSize);

        fs.read(
            this.fileDescriptor,
            buffer,
            0,
            this.chunkSize,
            this.offset,
            (error, bytesRead) => {

                if (error) {

                    console.error(
                        "Error reading file chunk:",
                        error.message
                    );

                    this.fileSocket.destroy();
                    return;
                }

                if (bytesRead === 0) {

                    console.log(
                        "All chunks sent. Waiting for receiver confirmation..."
                    );

                    fs.close(
                        this.fileDescriptor,
                        () => {}
                    );

                    return;
                }

                const dataToSend =
                    buffer.subarray(
                        0,
                        bytesRead
                    );

                const chunkHash =
                    HashService.hashBuffer(
                        dataToSend
                    );


                const compressed =
                    CompressionService.compressBuffer(
                        dataToSend
                    );


                const encrypted =
                    EncryptionService.encryptBuffer(
                        compressed,
                        this.encryptionKey
                    );


                const frame =
                    ChunkProtocol.createChunkFrame(
                        this.chunkNumber,
                        encrypted.encryptedData,
                        chunkHash,
                        encrypted.iv,
                        encrypted.authTag,
                        true
                    );

                console.log(
                    `Prepared chunk ${this.chunkNumber} | Original: ${bytesRead} bytes | Compressed: ${compressed.length} bytes | Encrypted: ${encrypted.encryptedData.length} bytes`
                );

                this.offset += bytesRead;
                this.chunkNumber++;

                const canWriteMore =
                    this.fileSocket.write(frame);

                if (canWriteMore) {

                    this.sendNextChunk();

                } else {

                    this.fileSocket.once(
                        "drain",
                        () => {
                            this.sendNextChunk();
                        }
                    );
                }
            }
        );
    }    

    resendChunk(chunkNumber) {

        if (
            !this.activeTransfer ||
            !this.fileSocket
        ) {
            return;
        }

        const chunkOffset =
            chunkNumber * this.chunkSize;

        const buffer =
            Buffer.alloc(this.chunkSize);

        fs.open(
            this.activeTransfer.filePath,
            "r",
            (openError, fd) => {

                if (openError) {

                    console.error(
                        `Could not reopen file for chunk ${chunkNumber}:`,
                        openError.message
                    );

                    return;
                }

                fs.read(
                    fd,
                    buffer,
                    0,
                    this.chunkSize,
                    chunkOffset,
                    (readError, bytesRead) => {

                        fs.close(
                            fd,
                            () => {}
                        );

                        if (readError) {

                            console.error(
                                `Could not read chunk ${chunkNumber} for retransmission:`,
                                readError.message
                            );

                            return;
                        }

                        if (bytesRead === 0) {

                            console.error(
                                `Chunk ${chunkNumber} does not exist`
                            );

                            return;
                        }

                        const dataToSend =
                            buffer.subarray(
                                0,
                                bytesRead
                            );

                        const chunkHash =
                            HashService.hashBuffer(
                                dataToSend
                            );


                        const compressed =
                            CompressionService.compressBuffer(
                                dataToSend
                            );


                        const encrypted =
                            EncryptionService.encryptBuffer(
                                compressed,
                                this.encryptionKey
                            );


                        const frame =
                            ChunkProtocol.createChunkFrame(
                                chunkNumber,
                                encrypted.encryptedData,
                                chunkHash,
                                encrypted.iv,
                                encrypted.authTag,
                                true
                            );


                        console.log(
                            `Retransmitting compressed + encrypted chunk ${chunkNumber} | Original: ${bytesRead} bytes | Compressed: ${compressed.length} bytes`
                        );


                        this.fileSocket.write(
                            frame
                        );
                    }
                );
            }
        );
    }

    pauseTransfer() {
        if (!this.isPaused && this.fileSocket) {
            this.isPaused = true;
            this.activeTransfer.status = "paused";
            console.log("Transfer paused at offset:", this.offset);
            return true;
        }
        return false;
    }

    resumeTransfer() {
        if (this.isPaused && this.fileSocket) {
            this.isPaused = false;
            this.activeTransfer.status = "transferring";
            console.log("Transfer resumed from offset:", this.offset);
            
            // Kickstart the loop again
            this.sendNextChunk();
            return true;
        }
        return false;
    }

    cancelTransfer() {
        if (this.fileSocket) {
            this.isPaused = true;
            this.fileSocket.destroy();
            console.log("Transfer cancelled by sender.");
            this.cleanupTemporaryFile();
            return true;
        }
        return false;
    }

    cleanupTemporaryFile() {

        if (!this.activeTransfer) {
            return;
        }

        fs.unlink(
            this.activeTransfer.filePath,
            (error) => {

                if (error) {

                    console.error(
                        "Could not delete temporary file:",
                        error.message
                    );

                    return;
                }

                console.log(
                    `Temporary file deleted: ${this.activeTransfer.filePath}`
                );

                this.activeTransfer = null;
                
                // Process the next file in the queue, if any
                this.processQueue();
            }
        );
    }
}

module.exports = TransferManager;