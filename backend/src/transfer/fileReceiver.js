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

        const fileDescriptor =
        fs.openSync(
            filePath,
            "w"
        );

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

            const chunkPosition =
                metadata.chunkNumber *
                (64 * 1024);


            fs.writeSync(
                fileDescriptor,
                chunkData,
                0,
                chunkData.length,
                chunkPosition
            );


            receivedBytes +=
                chunkData.length;


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

            fs.closeSync(
                fileDescriptor
            );

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
        }


        const handleIncomplete = () => {

            if (!transferCompleted) {

                transferCompleted = true;

                console.error(
                    `File transfer ended early: ${receivedBytes}/${fileSize} bytes`
                );

                try {

                    fs.closeSync(
                        fileDescriptor
                    );

                } catch (error) {

                    console.error(
                        "Could not close incomplete file:",
                        error.message
                    );
                }


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