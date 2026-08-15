const fs = require("fs");
const path = require("path");

class TransferManager {

    constructor(connectionManager) {
        // Used to send transfer requests through an existing TCP connection
        this.connectionManager = connectionManager;
    }

    // Create file metadata before starting transfer
    createTransferRequest(filePath) {

        const fileStats = fs.statSync(filePath);

        return {
            type: "FILE_TRANSFER_REQUEST",
            fileName: path.basename(filePath),
            fileSize: fileStats.size,
            filePath: filePath
        };
    }
}

module.exports = TransferManager;