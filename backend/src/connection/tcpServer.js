const net = require("net");
const crypto44 = require("crypto");

const { TCP_PORT } = require("../config");
const KeyExchangeService =
    require("../security/keyExchangeService");

const FolderScanner =
    require("../sync/folderScanner");
const { verifyCheckpoint } =
    require("../transfer/resumeCheckpoint");

class TCPServer {

    constructor(connectionState,transferManager) {

        // Shared connection state
        this.connectionState = connectionState;
        this.transferManager = transferManager;

        this.server = net.createServer((socket) => {
            this.handleConnection(socket);
        });

        // No incoming request initially
        this.pendingSocket = null;
        this.phase44Pair = null;
        this.phase44Failures = new Map();

        // No file transfer request is pending initially
        this.pendingFileRequest = null;
        this.connectionManager = null;
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

        let messageBuffer = "";

        socket.on("data", (data) => {

            messageBuffer +=
                data.toString();


            let newlineIndex;


            while (
                (newlineIndex =
                    messageBuffer.indexOf("\n")) !== -1
            ) {

                const messageText =
                    messageBuffer
                        .slice(0, newlineIndex)
                        .trim();


                messageBuffer =
                    messageBuffer.slice(
                        newlineIndex + 1
                    );


                if (!messageText) {
                    continue;
                }


                try {

                    const message =
                        JSON.parse(
                            messageText
                        );

                if (message.type === "LAN_CHAT") {
                    if (this.communicationService) {
                        this.communicationService.receive(message);
                    }
                    continue;
                }

                if (
                    message.type === "FILE_TRANSFER_REQUEST" &&
                    this.communicationService
                ) {
                    this.communicationService.addActivity(
                        "incoming-request",
                        message.fileName || "Unnamed file"
                    );
                }


                if (
                    this.connectionManager &&
                    ["FILE_TRANSFER_ACCEPTED","FILE_TRANSFER_REJECTED","FOLDER_SYNC_RESPONSE","FOLDER_SYNC_ERROR"].includes(message.type)
                ) {
                    this.connectionManager.handlePeerResponse(
                        message,
                        peerIp
                    );
                    continue;
                }

                if (message.type === "CONNECTION_REQUEST") {

                    // PHASE44A: optional pairing credential.
                    // Existing manual connections remain supported.

                    if (message.phase44Credential) {

                        const p = this.phase44Pair;
                        const now = Date.now();

                        const attempts =
                            this.phase44Failures.get(peerIp) ||
                            { count: 0, until: 0 };

                        const supplied = String(
                            message.phase44Credential.value || ""
                        );

                        const kind =
                            message.phase44Credential.kind;

                        const expected =
                            p && kind === "qr"
                                ? p.token
                                : p && p.pin;

                        const validFormat =
                            (kind === "qr" &&
                                supplied.length === 64) ||
                            (kind === "pin" &&
                                /^[0-9]{6}$/.test(supplied));

                        const match =
                            p &&
                            now < p.expires &&
                            now >= attempts.until &&
                            validFormat &&
                            expected &&
                            supplied.length === expected.length &&
                            crypto44.timingSafeEqual(
                                Buffer.from(supplied),
                                Buffer.from(expected)
                            );

                        if (!match) {

                            attempts.count++;

                            if (attempts.count >= 5) {
                                attempts.until = now + 60000;
                                attempts.count = 0;
                            }

                            this.phase44Failures.set(
                                peerIp,
                                attempts
                            );

                            socket.write(
                                JSON.stringify({
                                    type: "CONNECTION_REJECTED",
                                    reason:
                                        "Invalid or expired pairing code"
                                }) + "\n"
                            );

                            socket.end();
                            continue;
                        }

                        if (
                            this.connectionState.status !==
                            "disconnected"
                        ) {
                            socket.write(
                                JSON.stringify({
                                    type: "CONNECTION_REJECTED"
                                }) + "\n"
                            );

                            socket.end();
                            continue;
                        }

                        // Pairing credential is single-use.
                        this.phase44Pair = null;

                        this.phase44Failures.delete(peerIp);

                        this.connectionState.setPending(
                            peerIp,
                            socket
                        );

                        this.pendingSocket = socket;

                        // Valid credential: accept connection.
                        this.acceptConnection();

                        continue;
                    }


                    // Only one connection/request is allowed at a time
                    if (this.connectionState.status !== "disconnected") {

                        socket.write(
                            JSON.stringify({
                                type: "CONNECTION_REJECTED"
                            }) + "\n"
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

                if (message.type === "FILE_TRANSFER_REQUEST") {

                    console.log(
                        `Incoming file request: ${message.fileName} (${message.fileSize} bytes)`
                    );

                    this.pendingFileRequest = {

                        fileName:
                            message.fileName,

                        fileSize:
                            message.fileSize,

                        transferId:
                            message.transferId,

                        senderPublicKey:
                            message.publicKey,

                        resume:
                            message.resume === true,

                        isFolderSync:
                            message.isFolderSync === true,

                        relativePath:
                            message.relativePath || null,

                        destinationPath:
                            message.destinationPath || null,

                        socket:
                            socket
                    };

                    if (this.pendingFileRequest.isFolderSync) {

                        console.log(
                            `Folder sync file request: ${this.pendingFileRequest.relativePath}`
                        );

                        console.log(
                            `Folder sync destination: ${this.pendingFileRequest.destinationPath}`
                        );
                    }
                }

                if (
                    message.type ===
                    "FOLDER_SYNC_REQUEST"
                ) {

                    console.log(
                        "Folder sync request received"
                    );


                    const destinationPath =
                        message.destinationPath;


                    FolderScanner
                        .scanFolder(
                            destinationPath
                        )
                        .then(
                            (destinationManifest) => {

                                socket.write(
                                    JSON.stringify({
                                        type:
                                            "FOLDER_SYNC_RESPONSE",

                                        destinationManifest:
                                            destinationManifest

                                    }) + "\n"
                                );


                                console.log(
                                    `Folder manifest sent: ${destinationManifest.length} files`
                                );
                            }
                        )
                        .catch(
                            (error) => {

                                console.error(
                                    "Could not scan destination folder:",
                                    error.message
                                );


                                socket.write(
                                    JSON.stringify({
                                        type:
                                            "FOLDER_SYNC_ERROR",

                                        message:
                                            error.message

                                    }) + "\n"
                                );
                            }
                        );
                }


                } catch (error) {

                    console.error(
                        "Invalid TCP message:",
                        error.message
                    );
                }
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
                const transfer = this.transferManager.activeTransfer;
                if (transfer?.status === "pending" && transfer.controlSocket === socket) {
                    this.transferManager.finishTransfer("interrupted", transfer);
                }
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
            }) + "\n"
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
            }) + "\n"
        );


        this.pendingSocket = null;

        // Return receiver to disconnected state
        this.connectionState.reset();

        socket.end();

        console.log("Connection rejected");

        return true;
    }

    acceptFileTransfer() {
        this.lastFileTransferError = null;
        if (!this.pendingFileRequest) {
            console.log("No pending file transfer request");
            this.lastFileTransferError = "No pending file transfer request";
            return false;
        }
        // PHASE44B_RESUME_REQUEST_GUARD_V1
        if (
            this.pendingFileRequest.resume === true &&
            this.pendingFileRequest.isFolderSync === true
        ) {
            console.error(
                "Folder sync resume is not supported"
            );
            this.lastFileTransferError = "Folder sync resume is not supported";

            return false;
        }

        // PHASE44B_RESUME_CHECKPOINT_GUARD_V1
        if (this.pendingFileRequest.resume === true) {
            try {
                const request = this.pendingFileRequest;

                if (
                    typeof request.transferId !== "string" ||
                    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(request.transferId) ||
                    typeof request.fileName !== "string" ||
                    !request.fileName ||
                    !Number.isSafeInteger(request.fileSize) ||
                    request.fileSize <= 0
                ) {
                    throw new Error("Invalid resume request metadata");
                }

                const checkpoint = verifyCheckpoint(
                    request.transferId,
                    {
                        fileName: request.fileName,
                        fileSize: request.fileSize
                    }
                );

                if (!checkpoint) {
                    throw new Error(
                        "No checkpoint available for this transfer"
                    );
                }

                console.log(
                    `Resume checkpoint accepted: ${checkpoint.verifiedBytes} verified bytes`
                );
            } catch (error) {
                console.error(
                    "Resume request rejected:",
                    error.message
                );
                this.lastFileTransferError = error.message;

                return false;
            }
        }
        const socket = this.pendingFileRequest.socket;

        const transferId =
            this.pendingFileRequest.transferId;

        const senderPublicKey =
            this.pendingFileRequest.senderPublicKey;


        const keyExchange =
            KeyExchangeService.createKeyPair();


        const sessionKey =
            KeyExchangeService.deriveSessionKey(
                keyExchange.ecdh,
                senderPublicKey
            );


        this.transferManager
            .sessionKeyManager
            .storeSessionKey(
                transferId,
                sessionKey
            );


        console.log(
            `Receiver session key established for transfer ${transferId}`
        );

        socket.write(
            JSON.stringify({

                type:
                    "FILE_TRANSFER_ACCEPTED",

                transferId:
                    transferId,

                publicKey:
                    keyExchange.publicKey

            }) + "\n"
        );

        console.log(
            `File transfer accepted: ${this.pendingFileRequest.fileName}`
        );

        this.pendingFileRequest = null;

        return true;
    }


    rejectFileTransfer() {

        if (!this.pendingFileRequest) {
            console.log("No pending file transfer request");
            return false;
        }

        const socket = this.pendingFileRequest.socket;

        socket.write(
            JSON.stringify({
                type: "FILE_TRANSFER_REJECTED",
                transferId: this.pendingFileRequest.transferId
            }) + "\n"
        );

        console.log(
            `File transfer rejected: ${this.pendingFileRequest.fileName}`
        );

        this.pendingFileRequest = null;

        return true;
    }
    handlePeerRequest(message, socket, peerIp) {
        for (let once = 0; once < 1; once++) {
if (message.type === "FILE_TRANSFER_REQUEST") {

                    console.log(
                        `Incoming file request: ${message.fileName} (${message.fileSize} bytes)`
                    );

                    this.pendingFileRequest = {

                        fileName:
                            message.fileName,

                        fileSize:
                            message.fileSize,

                        transferId:
                            message.transferId,

                        senderPublicKey:
                            message.publicKey,

                        resume:
                            message.resume === true,

                        isFolderSync:
                            message.isFolderSync === true,

                        relativePath:
                            message.relativePath || null,

                        destinationPath:
                            message.destinationPath || null,

                        socket:
                            socket
                    };

                    if (this.pendingFileRequest.isFolderSync) {

                        console.log(
                            `Folder sync file request: ${this.pendingFileRequest.relativePath}`
                        );

                        console.log(
                            `Folder sync destination: ${this.pendingFileRequest.destinationPath}`
                        );
                    }
                }
if (
                    message.type ===
                    "FOLDER_SYNC_REQUEST"
                ) {

                    console.log(
                        "Folder sync request received"
                    );


                    const destinationPath =
                        message.destinationPath;


                    FolderScanner
                        .scanFolder(
                            destinationPath
                        )
                        .then(
                            (destinationManifest) => {

                                socket.write(
                                    JSON.stringify({
                                        type:
                                            "FOLDER_SYNC_RESPONSE",

                                        destinationManifest:
                                            destinationManifest

                                    }) + "\n"
                                );


                                console.log(
                                    `Folder manifest sent: ${destinationManifest.length} files`
                                );
                            }
                        )
                        .catch(
                            (error) => {

                                console.error(
                                    "Could not scan destination folder:",
                                    error.message
                                );


                                socket.write(
                                    JSON.stringify({
                                        type:
                                            "FOLDER_SYNC_ERROR",

                                        message:
                                            error.message

                                    }) + "\n"
                                );
                            }
                        );
                }
        }
    }
}

module.exports = TCPServer;
