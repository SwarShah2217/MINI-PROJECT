const fs = require("fs");
const path = require("path");

class FileReceiver {

    receiveFile(socket, fileName, fileSize, initialData) {

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

        const filePath = path.join(
            downloadsDirectory,
            fileName
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

        socket.on("end", () => {

            // Connection closed before expected file size
            if (!transferCompleted) {

                console.error(
                    `File transfer ended early: ${receivedBytes}/${fileSize} bytes`
                );

                writeStream.end();
            }
        });

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
        });
    }
}

module.exports = FileReceiver;