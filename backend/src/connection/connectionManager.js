const net = require("net");
const path = require("path");
const { TCP_PORT } = require("../config");
const KeyExchangeService =
    require("../security/keyExchangeService");
const FolderComparator =
    require("../sync/folderComparator");

class ConnectionManager {

    constructor(connectionState, transferManager) {
        // Shared connection state used by sender and receiver
        this.connectionState = connectionState;

        // Used to create the separate file-transfer connection
        this.transferManager = transferManager;
        this.pendingFolderManifest = null;
        this.lastFolderComparison = null;
        this.pendingFolderSourcePath = null;
        this.pendingFolderDestinationPath = null;
    }

    connectToDevice(ip) {

        // Prevent duplicate connection requests
        if (this.connectionState.status !== "disconnected") {
            console.log("Already connected or connection request is pending");
            return;
        }

        // Mark connection as being attempted
        this.connectionState.setConnecting(ip);

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

                socket.write(
                    JSON.stringify(request) +
                    "\n"
                );
            }
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

                if (message.type === "CONNECTION_ACCEPTED") {

                    // Mark the connection as fully active
                    this.connectionState.setConnected(
                        ip,
                        socket
                    );

                    console.log("Connection accepted by peer");
                }


                if (message.type === "CONNECTION_REJECTED") {

                    console.log("Connection rejected by peer");

                    // Reset connection state
                    this.connectionState.reset();

                    socket.end();
                }

                if (message.type === "FILE_TRANSFER_ACCEPTED") {

                    console.log("File transfer accepted by peer");

                    const transferId =
                        message.transferId;

                    const senderECDH =
                        this.transferManager
                            .keyExchanges
                            .get(transferId);


                    if (!senderECDH) {

                        console.error(
                            `No ECDH key exchange found for transfer ${transferId}`
                        );

                        return;
                    }


                    const sessionKey =
                        KeyExchangeService.deriveSessionKey(
                            senderECDH,
                            message.publicKey
                        );


                    this.transferManager
                        .sessionKeyManager
                        .storeSessionKey(
                            transferId,
                            sessionKey
                        );


                    this.transferManager
                        .keyExchanges
                        .delete(transferId);


                    console.log(
                        `Sender session key established for transfer ${transferId}`
                    );

                    this.transferManager
                        .connectForFileTransfer(ip)
                        .then((fileSocket) => {

                            console.log(
                                "Ready to send file data"
                            );

                            this.transferManager.sendFile(fileSocket);

                        })
                        .catch((error) => {

                            console.error(
                                "Could not establish file transfer connection:",
                                error.message
                            );
                        });
                }

                if (message.type === "FILE_TRANSFER_REJECTED") {
                    console.log("File transfer rejected by peer");
                }

                if (
                    message.type ===
                    "FOLDER_SYNC_RESPONSE"
                ) {

                    console.log(
                        "Destination folder manifest received"
                    );


                    if (!this.pendingFolderManifest) {

                        console.error(
                            "No source folder manifest is pending"
                        );

                        continue;
                    }


                    const comparison =
                        FolderComparator.compareFolders(
                            this.pendingFolderManifest,
                            message.destinationManifest
                        );


                    this.lastFolderComparison =
                        comparison;


                    this.pendingFolderManifest =
                        null;


                    console.log(
                        "Folder comparison complete"
                    );

                    console.log(
                        `New files: ${comparison.newFiles.length}`
                    );

                    console.log(
                        `Modified files: ${comparison.modifiedFiles.length}`
                    );

                    console.log(
                        `Unchanged files: ${comparison.unchangedFiles.length}`
                    );

                    const filesToSync = [
                        ...comparison.newFiles,
                        ...comparison.modifiedFiles
                    ];

                    console.log(
                        `Files selected for sync: ${filesToSync.length}`
                    );

                    for (const file of filesToSync) {

                        const sourceFilePath =
                            path.join(
                                this.pendingFolderSourcePath,
                                file.relativePath
                            );

                        console.log(
                            `Queueing folder sync file: ${file.relativePath}`
                        );

                        const queued =
                            this.transferManager
                                .sendFileFromPath(
                                    sourceFilePath,
                                    file.relativePath,
                                    this.pendingFolderDestinationPath
                                );

                        if (!queued) {

                            console.error(
                                `Could not queue folder sync file: ${file.relativePath}`
                            );
                        }
                    }
                }


                if (
                    message.type ===
                    "FOLDER_SYNC_ERROR"
                ) {

                    console.error(
                        "Folder sync error from peer:",
                        message.message
                    );

                    this.pendingFolderManifest =
                        null;
                }

                } catch (error) {

                    console.error(
                        "Invalid TCP response:",
                        error.message
                    );
                }
            }
        });

        socket.on("error", (error) => {

            console.error(
                `Connection error with ${ip}:`,
                error.message
            );

            // Reset if connection fails
            this.connectionState.reset();
        });


        socket.on("close", () => {

            console.log(`Connection closed with ${ip}`);

            // Reset state only if this was the active/pending peer
            if (this.connectionState.peerIp === ip) {
                this.connectionState.reset();
            }
        });


        return socket;
    }

    sendFolderSyncRequest(
        sourceManifest,
        sourcePath,
        destinationPath
    ) {

        if (
            this.connectionState.status !==
            "connected"
        ) {

            return false;
        }


        const socket =
            this.connectionState.socket;


        if (!socket) {

            return false;
        }


        this.pendingFolderManifest =
            sourceManifest;

        this.pendingFolderSourcePath =
            sourcePath;

        this.pendingFolderDestinationPath =
            destinationPath;

        this.lastFolderComparison =
            null;


        socket.write(
            JSON.stringify({
                type:
                    "FOLDER_SYNC_REQUEST",

                destinationPath:
                    destinationPath

            }) + "\n"
        );


        console.log(
            `Folder sync request sent with ${sourceManifest.length} source files`
        );


        return true;
    }

}

module.exports = ConnectionManager;