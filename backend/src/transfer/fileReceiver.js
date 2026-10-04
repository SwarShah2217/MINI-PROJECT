const fs = require("fs");
const path = require("path");

const ChunkProtocol =
    require("./chunkProtocol");
const HashService =
    require("../integrity/hashService");

class FileReceiver {

    receiveFile(
        socket,
        fileName,
        fileSize,
        transferId,
        initialData
    ) {

        const downloadsDirectory =
            path.join(
                __dirname,
                "../../downloads"
            );

        if (!fs.existsSync(downloadsDirectory)) {

            fs.mkdirSync(
                downloadsDirectory,
                {
                    recursive: true
                }
            );
        }

        fileName =
            path.basename(fileName);

        const safeFileName =
            transferId
                ? `${transferId}-${fileName}`
                : fileName;

        const filePath =
            path.join(
                downloadsDirectory,
                safeFileName
            );

        const writeStream =
            fs.createWriteStream(filePath);

        let receivedBytes = 0;
        let transferCompleted = false;

        const parseChunk = 
            ChunkProtocol.createParser(
                (metadata, chunkData) => {

            if (transferCompleted) {
                return;
            }

            if (
                receivedBytes +
                chunkData.length >
                fileSize
            ) {

                console.error(
                    "Received more data than expected"
                );

                socket.destroy();
                return;
            }


            const calculatedHash =
                HashService.hashBuffer(
                    chunkData
                );


            const isValid =
                HashService.hashesMatch(
                    metadata.hash,
                    calculatedHash
                );


            if (!isValid) {

    console.error(
        `Chunk ${metadata.chunkNumber} FAILED SHA-256 verification`
    );

    console.error(
        `Expected:   ${metadata.hash}`
    );

    console.error(
        `Calculated: ${calculatedHash}`
    );

    socket.write(
        JSON.stringify({
            type: "CHUNK_NACK",
            chunkNumber: metadata.chunkNumber
        }) + "\n"
    );

    return;
}

            console.log(
                `Chunk ${metadata.chunkNumber} SHA-256 VERIFIED`
            );

            socket.write(
                JSON.stringify({
                    type: "CHUNK_ACK",
                    chunkNumber: metadata.chunkNumber
                }) + "\n"
            );

            receivedBytes +=
                chunkData.length;


            writeStream.write(
                chunkData
            );


            console.log(
                `Received ${receivedBytes}/${fileSize} bytes`
            );


            if (
                receivedBytes ===
                fileSize
            ) {

                completeTransfer();
            }
        }
    );

        function handleData(data) {

            try {

                parseChunk(data);

            } catch (error) {

                console.error(
                    "Chunk protocol error:",
                    error.message
                );

                socket.destroy();
            }
        }


        function completeTransfer() {

            if (transferCompleted) {
                return;
            }

            transferCompleted = true;

            socket.removeListener(
                "data",
                handleData
            );

            writeStream.end();
        }


        const handleIncomplete = () => {

            if (!transferCompleted) {

                transferCompleted = true;

                console.error(
                    `File transfer ended early: ${receivedBytes}/${fileSize} bytes`
                );

                writeStream.close(() => {

                    fs.unlink(
                        filePath,
                        (error) => {

                            if (!error) {

                                console.log(
                                    `Deleted partially downloaded file: ${filePath}`
                                );
                            }
                        }
                    );
                });
            }
        };


        socket.on(
            "data",
            handleData
        );


        if (
            initialData &&
            initialData.length > 0
        ) {

            handleData(initialData);
        }


        socket.on(
            "end",
            handleIncomplete
        );

        socket.on(
            "close",
            handleIncomplete
        );


        writeStream.on(
            "finish",
            () => {

                if (
                    receivedBytes ===
                    fileSize
                ) {

                    console.log(
                        `File received successfully: ${filePath}`
                    );

                    console.log(
                        `Transfer complete: ${receivedBytes}/${fileSize} bytes`
                    );

                    socket.write(
                        JSON.stringify({
                            type:
                                "FILE_TRANSFER_COMPLETE"
                        }) + "\n"
                    );

                } else {

                    console.error(
                        `File transfer incomplete: ${receivedBytes}/${fileSize} bytes`
                    );
                }
            }
        );


        writeStream.on(
            "error",
            (error) => {

                console.error(
                    "Error writing received file:",
                    error.message
                );

                socket.destroy();
            }
        );


        socket.on(
            "error",
            (error) => {

                console.error(
                    "File receiver socket error:",
                    error.message
                );

                handleIncomplete();
            }
        );
    }
}

module.exports = FileReceiver;