const fs = require("fs");
const path = require("path");

const ChunkProtocol =
    require("./chunkProtocol");
const HashService =
    require("../integrity/hashService");

const EncryptionService =
    require("../security/encryptionService");

class FileReceiver {

    receiveFile(
        socket,
        fileName,
        fileSize,
        transferId,
        fileHash,
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


            let dataToVerify =
                chunkData;


            if (metadata.encrypted) {

                if (
                    typeof metadata.iv !== "string" ||
                    typeof metadata.authTag !== "string"
                ) {

                    console.error(
                        `Chunk ${metadata.chunkNumber} is missing encryption metadata`
                    );

                    socket.destroy();
                    return;
                }


                if (!this.encryptionKey) {

                    console.error(
                        "No encryption key available for decryption"
                    );

                    socket.destroy();
                    return;
                }


                try {

                    const iv =
                        Buffer.from(
                            metadata.iv,
                            "base64"
                        );

                    const authTag =
                        Buffer.from(
                            metadata.authTag,
                            "base64"
                        );


                    dataToVerify =
                        EncryptionService.decryptBuffer(
                            chunkData,
                            this.encryptionKey,
                            iv,
                            authTag
                        );


                    console.log(
                        `Chunk ${metadata.chunkNumber} DECRYPTED`
                    );

                } catch (error) {

                    console.error(
                        `Chunk ${metadata.chunkNumber} DECRYPTION FAILED:`,
                        error.message
                    );


                    socket.write(
                        JSON.stringify({
                            type: "CHUNK_NACK",
                            chunkNumber:
                                metadata.chunkNumber
                        }) + "\n"
                    );

                    return;
                }
            }


            const calculatedHash =
                HashService.hashBuffer(
                    dataToVerify
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
                dataToVerify,
                0,
                dataToVerify.length,
                chunkPosition
            );

            receivedBytes +=
                dataToVerify.length;


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

        async function completeTransfer() {
            if (transferCompleted) {
                return;
            }

            transferCompleted = true;

            socket.removeListener(
                "data",
                handleData
            );

            try {
                fs.closeSync(
                    fileDescriptor
                );


                console.log(
                    "Calculating final file SHA-256..."
                );


                const calculatedFileHash =
                    await HashService.hashFile(
                        filePath
                    );


                console.log(
                    `Expected file SHA-256:   ${fileHash}`
                );

                console.log(
                    `Calculated file SHA-256: ${calculatedFileHash}`
                );


                const fileValid =
                    HashService.hashesMatch(
                        fileHash,
                        calculatedFileHash
                    );


                if (!fileValid) {

                    console.error(
                        "FINAL FILE SHA-256 VERIFICATION FAILED"
                    );


                    fs.unlink(
                        filePath,
                        (error) => {

                            if (!error) {

                                console.log(
                                    "Deleted file that failed final integrity verification"
                                );
                            }
                        }
                    );


                    socket.write(
                        JSON.stringify({
                            type:
                                "FILE_INTEGRITY_FAILED"
                        }) + "\n"
                    );

                    return;
                }


                console.log(
                    "FINAL FILE SHA-256 VERIFIED"
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


            } catch (error) {

                console.error(
                    "Final file verification error:",
                    error.message
                );

                socket.destroy();
            }
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