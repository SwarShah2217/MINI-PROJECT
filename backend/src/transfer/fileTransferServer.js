const net = require("net");
const path = require("path");

const { FILE_TRANSFER_PORT } = require("../config");
const FileReceiver = require("./fileReceiver");
const { verifyCheckpoint } = require("./resumeCheckpoint");

class FileTransferServer {

    constructor(transferManager) {
        this.transferManager = transferManager;
        this.fileReceiver = new FileReceiver();
        // PHASE44B_TRANSFER_ID_LOCK_V2
        this.activeTransferIds = new Set();
        this.server = net.createServer((socket) => {

            console.log(
                `File transfer connection received from ${socket.remoteAddress}:${socket.remotePort}`
            );

            let headerBuffer = Buffer.alloc(0);
            let headerReceived = false;

            // PHASE44B_FINALIZATION_AWARE_LOCK_V1
            let lockedResumeId = null;
            let socketClosed = false;
            let receiverFinalized = false;
            let receiverStarted = false;

            const releaseResumeLock = () => {
                if (lockedResumeId === null) return;

                // Never release while the receiver is still finalizing.
                if (receiverStarted && !receiverFinalized) return;

                this.activeTransferIds.delete(lockedResumeId);
                lockedResumeId = null;
            };

            socket.once("close", () => {
                socketClosed = true;
                releaseResumeLock();
            });

            const onReceiverFinalized = () => {
                receiverFinalized = true;

                if (socketClosed) {
                    releaseResumeLock();
                }
            };

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
                        
                        const sessionKey =
                            this.transferManager
                                .sessionKeyManager
                                .getSessionKey(
                                    header.transferId
                                );


                        if (!sessionKey) {

                            console.error(
                                `No receiver session key for transfer ${header.transferId}`
                            );

                            socket.destroy();
                            return;
                        }


                        // PHASE44B_RESUME_HANDSHAKE_V1
                        // Each connection has its own receiver and encryption key.
                        const receiver = new FileReceiver();
                        receiver.encryptionKey = sessionKey;

                        const wantsResume = header.resume === true;

                        if (
                            typeof header.fileName !== "string" ||
                            !header.fileName ||
                            path.basename(header.fileName) !== header.fileName ||
                            !Number.isSafeInteger(header.fileSize) ||
                            header.fileSize < 0 ||
                            typeof header.fileHash !== "string" ||
                            !/^[a-f0-9]{64}$/i.test(header.fileHash)
                        ) {
                            throw new Error("Invalid transfer metadata");
                        }

                        if (wantsResume && header.isFolderSync === true) {
                            throw new Error("Folder sync resume is not supported");
                        }

                        // PHASE44B_ALL_TRANSFER_LOCK_V2
                        if (
                            typeof header.transferId !== "string" ||
                            !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(header.transferId)
                        ) {
                            throw new Error("Invalid transfer ID");
                        }

                        if (this.activeTransferIds.has(header.transferId)) {
                            throw new Error(
                                "Another connection is already using this transfer ID"
                            );
                        }

                        this.activeTransferIds.add(header.transferId);
                        lockedResumeId = header.transferId;

                        let resumeState = null;

                        if (wantsResume) {
                            resumeState = verifyCheckpoint(
                                header.transferId,
                                {
                                    fileName: header.fileName,
                                    fileSize: header.fileSize,
                                    fileHash: header.fileHash
                                }
                            );

                            if (!resumeState) {
                                throw new Error("No matching checkpoint for resume");
                            }

                            if (remainingData.length > 0) {
                                throw new Error(
                                    "Sender transmitted chunks before RESUME_READY"
                                );
                            }
                        }

                        const startedAt = Date.now();
                        const startBytes = resumeState?.verifiedBytes || 0;
                        const onProgress = (progress) => {
                            const elapsed = (Date.now() - startedAt) / 1000;
                            const speed = progress.status === "receiving" && elapsed > 0
                                ? Math.max(0, progress.receivedBytes - startBytes) / elapsed : 0;
                            this.transferManager.incomingTransfer = {
                                ...progress, transferId: header.transferId, fileName: header.fileName,
                                totalBytes: header.fileSize, bytesPerSecond: speed,
                                etaSeconds: speed > 0 ? (header.fileSize - progress.receivedBytes) / speed : null,
                                at: Date.now()
                            };
                        };
                        receiver.receiveFile(
                            socket,
                            header.fileName,
                            header.fileSize,
                            header.transferId,
                            header.fileHash,
                            remainingData,
                            header.isFolderSync === true,
                            header.relativePath || null,
                            header.destinationPath || null,
                            resumeState,
                            onReceiverFinalized,
                            onProgress
                        );
                        // receiveFile owns cleanup once initialization succeeds.
                        // Synchronous initialization failures close their own resources.
                        receiverStarted = true;

                        if (wantsResume) {
                            socket.write(
                                JSON.stringify({
                                    type: "RESUME_READY",
                                    transferId: header.transferId,
                                    verifiedBytes: resumeState.verifiedBytes,
                                    nextChunk: resumeState.nextChunk
                                }) + "\n"
                            );
                        }

                    } catch (error) {

                        console.error(
                            "Invalid file transfer header:",
                            error.message
                        );
                        releaseResumeLock();
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
