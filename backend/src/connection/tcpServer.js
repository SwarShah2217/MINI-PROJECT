const net = require("net");

const { TCP_PORT } = require("../config");
const KeyExchangeService =
    require("../security/keyExchangeService");

const FolderScanner =
    require("../sync/folderScanner");

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

        // No file transfer request is pending initially
        this.pendingFileRequest = null;
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

                if (message.type === "CONNECTION_REQUEST") {

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

                    // Store file request until user accepts or rejects it
                    this.pendingFileRequest = {
                        fileName: message.fileName,
                        fileSize: message.fileSize,
                        transferId: message.transferId,
                        senderPublicKey:message.publicKey,
                        socket: socket
                    };
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
        if (!this.pendingFileRequest) {
            console.log("No pending file transfer request");
            return false;
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
                type: "FILE_TRANSFER_REJECTED"
            }) + "\n"
        );

        console.log(
            `File transfer rejected: ${this.pendingFileRequest.fileName}`
        );

        this.pendingFileRequest = null;

        return true;
    }
}

module.exports = TCPServer;