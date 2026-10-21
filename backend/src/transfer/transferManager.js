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
        this.lastTransfer = null;
    }

    getStatus(now = Date.now()) {
        const transfer = this.activeTransfer;
        const bytes = transfer ? (this.acknowledgedBytes || 0) : 0;
        const elapsed = Math.max(0, (now - (this.progressStartedAt || now)) / 1000);
        const speed = transfer?.status === "transferring" && elapsed > 0
            ? Math.max(0, bytes - (this.progressStartBytes || 0)) / elapsed : 0;
        return {
            isPending: !!transfer, status: transfer?.status || "idle",
            transferId: transfer?.transferId || null, fileName: transfer?.fileName || null,
            sentBytes: bytes, totalBytes: transfer?.fileSize || 0,
            bytesPerSecond: speed,
            etaSeconds: speed > 0 ? Math.max(0, transfer.fileSize - bytes) / speed : null,
            queueLength: this.transferQueue.length, lastTransfer: this.lastTransfer,
            incoming: this.incomingTransfer || null
        };
    }

    finishTransfer(status, transfer = this.activeTransfer) {
        if (!transfer || this.activeTransfer !== transfer) return;
        transfer.status = status;
        this.lastTransfer = {
            transferId: transfer.transferId, fileName: transfer.fileName,
            fileSize: transfer.fileSize, status, at: Date.now()
        };
        const socket = this.fileSocket;
        this.fileSocket = null;
        this.activeTransfer = null;
        this.isPaused = false;
        this.awaitingAck = null;
        if (this.fileDescriptor !== undefined && this.fileDescriptor !== null) {
            try { fs.closeSync(this.fileDescriptor); } catch (error) {
                console.error("Could not close source file:", error.message);
            }
            this.fileDescriptor = null;
        }
        this.sessionKeyManager.removeSessionKey(transfer.transferId);
        this.keyExchanges.delete(transfer.transferId);
        if (status !== "completed" && transfer.phase43HistoryId && this.phase43History) {
            this.phase43History.update(transfer.phase43HistoryId, { status: "interrupted" });
        }
        // Keep uploaded/recovered sources for explicit recovery and inspection.
        // Folder-sync source files are also always retained.
        if (socket && !socket.destroyed) socket.end();
        this.processQueue();
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

    // PHASE44B_QUEUE_INTERRUPTED_TRANSFER_V1
    queueInterruptedTransfer(transferId, fileName, expectedSize) {
        if (
            this.connectionState.status !== "connected" ||
            !this.connectionState.socket ||
            this.connectionState.socket.destroyed
        ) {
            console.error("Cannot resume: peer is not connected");
            return false;
        }

        if (
            typeof transferId !== "string" ||
            !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(transferId) ||
            typeof fileName !== "string" ||
            fileName.length === 0 ||
            fileName === "." ||
            fileName === ".." ||
            path.basename(fileName) !== fileName ||
            fileName.includes("/") ||
            fileName.includes("\\") ||
            !Number.isSafeInteger(expectedSize) ||
            expectedSize <= 0
        ) {
            console.error("Invalid interrupted transfer metadata");
            return false;
        }

        const filePath = path.join(
            __dirname,
            "../../temp",
            `${transferId}-${fileName}`
        );

        let stats;

        try {
            stats = fs.statSync(filePath);

            if (!stats.isFile() || stats.size !== expectedSize) {
                throw new Error("Source file size does not match");
            }
        } catch (error) {
            console.error(
                "Cannot recover source file:",
                error.message
            );
            return false;
        }

        if (
            this.activeTransfer?.transferId === transferId ||
            this.transferQueue.some(
                (transfer) => transfer.transferId === transferId
            )
        ) {
            console.error("Transfer is already active or queued");
            return false;
        }

        this.transferQueue.push({
            transferId,
            fileName,
            fileSize: stats.size,
            filePath,
            resumeMode: true,
            status: "queued"
        });

        if (!this.activeTransfer) {
            this.processQueue();
        }

        console.log(
            `Interrupted transfer queued for recovery: ${transferId}`
        );

        return true;
    }

    sendFileFromPath(
        filePath,
        relativePath,
        destinationPath
    ) {

        if (
            this.connectionState.status !==
            "connected"
        ) {
            return false;
        }

        if (!filePath || !relativePath) {
            return false;
        }

        if (!fs.existsSync(filePath)) {

            console.error(
                `Folder sync file not found: ${filePath}`
            );

            return false;
        }

        const stats =
            fs.statSync(filePath);

        if (!stats.isFile()) {

            console.error(
                `Folder sync path is not a file: ${filePath}`
            );

            return false;
        }

        const transferId =
            require("crypto").randomUUID();

        this.transferQueue.push({

            fileName:
                path.basename(relativePath),

            fileSize:
                stats.size,

            transferId:
                transferId,

            filePath:
                filePath,

            relativePath:
                relativePath,

            destinationPath:
                destinationPath,

            isFolderSync:
                true,

            status:
                "queued"
        });

        console.log(
            `Folder sync file queued: ${relativePath} (${stats.size} bytes)`
        );

        if (!this.activeTransfer) {
            this.processQueue();
        }

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

        if (this.communicationService && this.transferQueue.length > 0) {
            const next = this.transferQueue[0];
            this.communicationService.addActivity(
                "outgoing-request",
                next.fileName || "Unnamed file"
            );
        }
this.activeTransfer = this.transferQueue.shift();
        this.activeTransfer.status = "pending";
        this.activeTransfer.controlSocket = socket;
        this.offset = 0;
        this.acknowledgedBytes = 0;

        const keyExchange =
            KeyExchangeService.createKeyPair();

        this.keyExchanges.set(
            this.activeTransfer.transferId,
            keyExchange.ecdh
        );

        const request = {
            type: "FILE_TRANSFER_REQUEST",

            // PHASE44B_RESUME_CONTROL_FLAG_V1
            resume: this.activeTransfer.resumeMode === true,

            fileName:
                this.activeTransfer.fileName,

            fileSize:
                this.activeTransfer.fileSize,

            transferId:
                this.activeTransfer.transferId,

            publicKey:
                keyExchange.publicKey,

            isFolderSync:
                this.activeTransfer.isFolderSync === true,

            relativePath:
                this.activeTransfer.relativePath || null,

            destinationPath:
                this.activeTransfer.destinationPath || null
        };

        socket.write(
            JSON.stringify(request) +
            "\n"
        );

    }

    connectForFileTransfer(peerIp) {

        const requestedTransfer = this.activeTransfer;

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

        // Late responses from an old socket must never affect the next file.
        if (this.activeTransfer !== requestedTransfer || this.fileSocket !== socket) continue;

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

        if (!message || typeof message !== "object" || typeof message.type !== "string") {
            socket.destroy();
            continue;
        }

        // PHASE44B_RESUME_READY_V1
        if (message.type === "RESUME_READY") {
            const transfer = this.activeTransfer;
            const chunkSize = 64 * 1024;

            const valid =
                transfer &&
                this.fileSocket === socket &&
                transfer.resumeMode === true &&
                message.transferId === transfer.transferId &&
                Number.isSafeInteger(message.verifiedBytes) &&
                Number.isSafeInteger(message.nextChunk) &&
                message.verifiedBytes >= 0 &&
                message.verifiedBytes <= transfer.fileSize &&
                message.nextChunk >= 0 &&
                message.nextChunk === Math.ceil(message.verifiedBytes / chunkSize) &&
                (message.verifiedBytes === transfer.fileSize || message.verifiedBytes % chunkSize === 0) &&
                !socket.destroyed;

            if (!valid) {
                console.error("Invalid or unexpected RESUME_READY response");
                socket.destroy();
                continue;
            }

            if (transfer.resumeReadyReceived === true) {
                console.error("Duplicate RESUME_READY response");
                socket.destroy();
                continue;
            }

            transfer.resumeReadyReceived = true;
            this.offset = message.verifiedBytes;
            this.acknowledgedBytes = this.offset;
            this.chunkNumber = message.nextChunk;
            this.progressStartedAt = Date.now();
            this.progressStartBytes = this.offset;

            console.log(
                `Verified resume position: ${this.offset} bytes, chunk ${this.chunkNumber}`
            );

            if (transfer.resumeFileReady === true) {
                this.sendNextChunk();
            } else {
                console.log("RESUME_READY received; waiting for source file to open");
            }
            continue;
        }

        if (
            message.type ===
            "CHUNK_ACK"
        ) {

            if (!Number.isSafeInteger(message.chunkNumber) || message.chunkNumber !== this.awaitingAck) {
                socket.destroy();
                continue;
            }
            this.awaitingAck = null;
            this.acknowledgedBytes = this.offset;
            this.sendNextChunk();

            continue;
        }


        if (
            message.type ===
            "CHUNK_NACK"
        ) {

            console.log(
                `NACK received for chunk ${message.chunkNumber}`
            );

            if (!Number.isSafeInteger(message.chunkNumber) || message.chunkNumber !== this.awaitingAck || ++this.chunkRetries > 3) {
                socket.destroy();
                continue;
            }
            this.resendChunk(message.chunkNumber);

            continue;
        }

        if (
            message.type ===
            "FILE_INTEGRITY_FAILED"
        ) {

            console.error(
                "Receiver reported FINAL FILE SHA-256 FAILURE"
            );

            this.finishTransfer("integrity_failed", requestedTransfer);

            continue;
        }


        if (
            message.type ===
            "FILE_TRANSFER_COMPLETE"
        ) {

            if (this.offset !== requestedTransfer.fileSize || this.awaitingAck !== null) {
                socket.destroy();
                continue;
            }

            console.log(
                "Receiver confirmed file transfer is complete"
            );

            // PHASE43: receiver has verified
            // the complete file SHA-256.
            if (
                this.activeTransfer &&
                this.activeTransfer.phase43HistoryId &&
                this.phase43History
            ) {
                this.phase43HistoryFileVerified(
                    this.activeTransfer.phase43HistoryId,
                    this.activeTransfer.relativePath
                );
            }

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
                this.finishTransfer("interrupted", requestedTransfer);
            });
        });
    }

    sendFile(fileSocket, resumeMode = false) {
        if (!this.activeTransfer) return;
        const transfer = this.activeTransfer;
        this.activeTransfer.status = "transferring";
        this.activeTransfer.resumeMode = resumeMode === true;
        this.activeTransfer.resumeReadyReceived = false;
        this.activeTransfer.resumeFileReady = false;
        this.fileSocket = fileSocket;
        this.isPaused = false;

        // State variables for manual chunking
        this.offset = 0;
        this.acknowledgedBytes = 0;
        this.chunkSize = 64 * 1024; // Send in 64 KB chunks
        this.chunkNumber = 0;
        this.awaitingAck = null;
        this.readInFlight = false;
        this.progressStartedAt = Date.now();
        this.progressStartBytes = 0;

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

            if (this.activeTransfer !== transfer || this.fileSocket !== fileSocket || fileSocket.destroyed) return;

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
                        fileHash,

                    isFolderSync:
                        this.activeTransfer.isFolderSync === true,

                    relativePath:
                        this.activeTransfer.relativePath || null,

                    destinationPath:
                        this.activeTransfer.destinationPath || null,

                    resume: resumeMode === true

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
                    if (this.activeTransfer !== transfer || this.fileSocket !== fileSocket || fileSocket.destroyed) {
                        if (!error) fs.close(fd, () => {});
                        return;
                    }
                    if (error) {
                        console.error(
                            "Error opening file:",
                            error.message
                        );

                        fileSocket.destroy();
                        return;
                    }

                    this.fileDescriptor = fd;

                    if (resumeMode) {
                        this.activeTransfer.resumeFileReady = true;

                        if (this.activeTransfer.resumeReadyReceived === true) {
                            this.sendNextChunk();
                        } else {
                            console.log("Source file opened; waiting for RESUME_READY");
                        }
                    } else {
                        this.sendNextChunk();
                    }
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

        if (this.isPaused || !this.fileSocket || this.fileSocket.destroyed ||
            !this.activeTransfer || this.readInFlight || this.awaitingAck !== null ||
            this.fileDescriptor === null || this.fileDescriptor === undefined) {
            return;
        }

        const transfer = this.activeTransfer;
        const socket = this.fileSocket;
        if (transfer.resumeMode && !transfer.resumeReadyReceived) return;
        if (this.offset === transfer.fileSize) {
            transfer.status = "verifying";
            fs.close(this.fileDescriptor, () => {});
            this.fileDescriptor = null;
            return;
        }
        this.readInFlight = true;

        const buffer =
            Buffer.alloc(this.chunkSize);

        fs.read(
            this.fileDescriptor,
            buffer,
            0,
            this.chunkSize,
            this.offset,
            (error, bytesRead) => {
                if (this.activeTransfer !== transfer || this.fileSocket !== socket || socket.destroyed) return;
                this.readInFlight = false;

                if (error) {

                    console.error(
                        "Error reading file chunk:",
                        error.message
                    );

                    this.fileSocket.destroy();
                    return;
                }

                if (bytesRead === 0) {
                    // Source changed/truncated after its initial SHA-256.
                    socket.destroy();
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


                const useCompression =
                    compressed.length < dataToSend.length;

                const payload = useCompression
                    ? compressed
                    : dataToSend;

                const encrypted =
                    EncryptionService.encryptBuffer(
                        payload,
                        this.encryptionKey
                    );


                const frame =
                    ChunkProtocol.createChunkFrame(
                        this.chunkNumber,
                        encrypted.encryptedData,
                        chunkHash,
                        encrypted.iv,
                        encrypted.authTag,
                        useCompression
                    );

                console.log(
                    `Prepared chunk ${this.chunkNumber} | Original: ${bytesRead} bytes | Compressed: ${compressed.length} bytes | Encrypted: ${encrypted.encryptedData.length} bytes`
                );

                this.awaitingAck = this.chunkNumber;
                this.chunkRetries = 0;
                this.offset += bytesRead;
                this.chunkNumber++;

                // Existing ACK/NACK frames pace chunks so retransmissions arrive
                // before subsequent chunks, as required by contiguous checkpoints.
                socket.write(frame);
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

        const transfer = this.activeTransfer;
        const socket = this.fileSocket;

        const chunkOffset =
            chunkNumber * this.chunkSize;

        const buffer =
            Buffer.alloc(this.chunkSize);

        fs.open(
            this.activeTransfer.filePath,
            "r",
            (openError, fd) => {
                if (this.activeTransfer !== transfer || this.fileSocket !== socket || socket.destroyed) {
                    if (!openError) fs.close(fd, () => {});
                    return;
                }

                if (openError) {

                    console.error(
                        `Could not reopen file for chunk ${chunkNumber}:`,
                        openError.message
                    );
                    socket.destroy();
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
                        if (this.activeTransfer !== transfer || this.fileSocket !== socket ||
                            socket.destroyed || this.awaitingAck !== chunkNumber) return;

                        if (readError) {

                            console.error(
                                `Could not read chunk ${chunkNumber} for retransmission:`,
                                readError.message
                            );
                            socket.destroy();
                            return;
                        }

                        if (bytesRead === 0) {

                            console.error(
                                `Chunk ${chunkNumber} does not exist`
                            );
                            socket.destroy();
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


                        const useCompression =
                            compressed.length < dataToSend.length;

                        const payload = useCompression
                            ? compressed
                            : dataToSend;

                        const encrypted =
                            EncryptionService.encryptBuffer(
                                payload,
                                this.encryptionKey
                            );


                        const frame =
                            ChunkProtocol.createChunkFrame(
                                chunkNumber,
                                encrypted.encryptedData,
                                chunkHash,
                                encrypted.iv,
                                encrypted.authTag,
                                useCompression
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
        if (!this.isPaused && this.fileSocket && this.activeTransfer?.status === "transferring") {
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
            this.progressStartedAt = Date.now();
            this.progressStartBytes = this.acknowledgedBytes;
            console.log("Transfer resumed from offset:", this.offset);

            // Kickstart the loop again
            this.sendNextChunk();
            return true;
        }
        return false;
    }

    cancelTransfer() {
        if (this.activeTransfer && this.fileSocket) {
            const transfer = this.activeTransfer;
            const socket = this.fileSocket;
            this.finishTransfer("cancelled", transfer);
            socket.destroy();
            return true;
        }
        return false;
    }

    cleanupTemporaryFile() {
        this.finishTransfer("completed");
    }
}

module.exports = TransferManager;
