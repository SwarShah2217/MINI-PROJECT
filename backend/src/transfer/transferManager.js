class TransferManager {

    constructor(connectionState) {
        // Shared connection state gives access to the active TCP socket
        this.connectionState = connectionState;
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
}

module.exports = TransferManager;