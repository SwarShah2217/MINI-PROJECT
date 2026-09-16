const fs = require("fs");
const path = require("path");

class FileReceiver {

    receiveFile(socket, fileName, fileSize, transferId, initialData) {

        const downloadsDirectory = path.join(
            __dirname,
            "../../downloads"
        );

        // Create downloads folder if it does not exist
        if (!fs.existsSync(downloadsDirectory)) {
            fs.mkdirSync(downloadsDirectory, {
                recursive: true
            });
        }

        // Prevent the incoming file name from containing a path
        fileName = path.basename(fileName);

        const safeFileName = transferId ? `${transferId}-${fileName}` : fileName;

        const filePath = path.join(
            downloadsDirectory,
            safeFileName
        );

        const writeStream =
            fs.createWriteStream(filePath);

        let receivedBytes = 0;

        // Some file bytes may have arrived together
        // with the header.
        if (initialData && initialData.length > 0) {

            writeStream.write(initialData);

            receivedBytes += initialData.length;

            console.log(
                `Received ${receivedBytes} bytes`
            );
        }

        // Receive the remaining file bytes
        socket.on("data", (data) => {

            receivedBytes += data.length;

            writeStream.write(data);

            console.log(
                `Received ${receivedBytes} bytes`
            );

            if (receivedBytes === fileSize) {
                completeTransfer();
            }
        });

        let transferCompleted = false;

        function completeTransfer() {

            if (transferCompleted) {
                return;
            }

            transferCompleted = true;

            writeStream.end();
        }

        const handleIncomplete = () => {
            if (!transferCompleted) {
                transferCompleted = true; // prevent multiple triggers
                console.error(`File transfer ended early: ${receivedBytes}/${fileSize} bytes`);
                writeStream.close(() => {
                    fs.unlink(filePath, (err) => {
                        if (!err) console.log(`Deleted partially downloaded file: ${filePath}`);
                    });
                });
            }
        };

        socket.on("end", handleIncomplete);
        socket.on("close", handleIncomplete);

        writeStream.on("finish", () => {

            if (receivedBytes === fileSize) {

                console.log(
                    `File received successfully: ${filePath}`
                );

                console.log(
                    `Transfer complete: ${receivedBytes}/${fileSize} bytes`
                );

                // Tell sender the complete file has been saved
                socket.write(JSON.stringify({
                    type: "FILE_TRANSFER_COMPLETE"
                }) + "\n");

            } else {

                console.error(
                    `File transfer incomplete: ${receivedBytes}/${fileSize} bytes`
                );
            }
        });

        writeStream.on("error", (error) => {

            console.error(
                "Error writing received file:",
                error.message
            );

            socket.destroy();
        });

        socket.on("error", (error) => {

            console.error(
                "File receiver socket error:",
                error.message
            );
            handleIncomplete();
        });
    }
}

module.exports = FileReceiver;