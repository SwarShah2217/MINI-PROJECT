const fs = require("fs");
const path = require("path");

const ChunkProtocol =
    require("./chunkProtocol");
const HashService =
    require("../integrity/hashService");

const EncryptionService =
    require("../security/encryptionService");

const CompressionService =
    require("../compression/compressionService");

class FileReceiver {

    // PHASE44B_CHECKPOINT_V1
    static saveCheckpoint(checkpointPath, state) {
        if (!checkpointPath) return;

        const tempPath = checkpointPath + ".tmp";

        fs.writeFileSync(
            tempPath,
            JSON.stringify(state, null, 2),
            { encoding: "utf8", mode: 0o600 }
        );

        fs.renameSync(tempPath, checkpointPath);
    }

    static removeCheckpoint(checkpointPath) {
        if (!checkpointPath) return;

        try {
            fs.unlinkSync(checkpointPath);
        } catch (error) {
            if (error.code !== "ENOENT") throw error;
        }
    }


    receiveFile(
        socket,
        fileName,
        fileSize,
        transferId,
        fileHash,
        initialData,
        isFolderSync = false,
        relativePath = null,
        destinationPath = null
    ) {

        let filePath;


        if (
            isFolderSync &&
            relativePath &&
            destinationPath
        ) {

            const normalizedRelativePath =
                path.normalize(relativePath);

            if (
                path.isAbsolute(
                    normalizedRelativePath
                ) ||
                normalizedRelativePath === ".." ||
                normalizedRelativePath.startsWith(
                    ".." + path.sep
                )
            ) {

                throw new Error(
                    "Invalid folder sync relative path"
                );
            }


            const destinationRoot =
                path.resolve(
                    destinationPath
                );


            filePath =
                path.resolve(
                    destinationRoot,
                    normalizedRelativePath
                );


            const relativeCheck =
                path.relative(
                    destinationRoot,
                    filePath
                );


            if (
                relativeCheck === ".." ||
                relativeCheck.startsWith(
                    ".." + path.sep
                ) ||
                path.isAbsolute(relativeCheck)
            ) {

                throw new Error(
                    "Folder sync path escapes destination folder"
                );
            }


            const parentDirectory =
                path.dirname(
                    filePath
                );


            fs.mkdirSync(
                parentDirectory,
                {
                    recursive: true
                }
            );


            console.log(
                `Folder sync destination file: ${filePath}`
            );

        } else {

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


            filePath =
                path.join(
                    downloadsDirectory,
                    safeFileName
                );
        }

        


        // Phase 4.4B checkpoints currently apply to regular
        // downloads only. Folder-sync semantics are unchanged.
        const checkpointEnabled =
            !isFolderSync &&
            typeof transferId === "string" &&
            transferId.length > 0;

        const checkpointDirectory = path.join(
            __dirname,
            "../../downloads/.checkpoints"
        );

        if (checkpointEnabled) {
            fs.mkdirSync(
                checkpointDirectory,
                { recursive: true }
            );
        }

        // Hash the transfer ID so untrusted IDs cannot become paths.
        const crypto = require("crypto");
        const checkpointName = checkpointEnabled
            ? crypto.createHash("sha256")
                .update(transferId)
                .digest("hex") + ".json"
            : null;

        const checkpointPath = checkpointEnabled
            ? path.join(checkpointDirectory, checkpointName)
            : null;

        const checkpoint = checkpointEnabled
            ? {
                version: 1,
                status: "receiving",
                transferId,
                fileName: path.basename(fileName),
                fileSize,
                fileHash,
                filePath,
                chunkSize: 64 * 1024,
                verifiedChunks: {},
                verifiedBytes: 0,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString()
            }
            : null;

        // This step does not reuse an older partial file.
        // Step 4.4B.3 will add validated resume negotiation.
        if (checkpointPath && fs.existsSync(checkpointPath)) {
            throw new Error(
                "An existing interrupted checkpoint was found " +
                "for this transfer ID. Resume support is not " +
                "installed yet; refusing to overwrite it."
            );
        }

        const fileDescriptor =
        fs.openSync(
            filePath,
            "w"
        );

        let receivedBytes = 0;
        let transferCompleted = false;

        if (checkpoint) {
            FileReceiver.saveCheckpoint(
                checkpointPath,
                checkpoint
            );
        }

        const parseChunk = 
            ChunkProtocol.createParser(
                (metadata, chunkData) => {

            if (transferCompleted) {
                return;
            }
/*
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
*/

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
            
           if (metadata.compressed) {

                try {

                    dataToVerify =
                        CompressionService.decompressBuffer(
                            dataToVerify
                        );

                    console.log(
                        `Chunk ${metadata.chunkNumber} DECOMPRESSED`
                    );

                } catch (error) {

                    console.error(
                        `Chunk ${metadata.chunkNumber} DECOMPRESSION FAILED:`,
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


            if (checkpoint) {
                // Ensure the verified bytes reach the file before
                // recording them in the persistent checkpoint.
                fs.fsyncSync(fileDescriptor);

                checkpoint.verifiedChunks[
                    String(metadata.chunkNumber)
                ] = {
                    size: dataToVerify.length,
                    hash: calculatedHash
                };

                checkpoint.verifiedBytes = receivedBytes;
                checkpoint.updatedAt =
                    new Date().toISOString();

                FileReceiver.saveCheckpoint(
                    checkpointPath,
                    checkpoint
                );
            }

            socket.write(
                JSON.stringify({
                    type: "CHUNK_ACK",
                    chunkNumber: metadata.chunkNumber
                }) + "\n"
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

                    FileReceiver.removeCheckpoint(
                        checkpointPath
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

                FileReceiver.removeCheckpoint(
                    checkpointPath
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


                if (checkpoint) {
                    checkpoint.status = "interrupted";
                    checkpoint.updatedAt =
                        new Date().toISOString();

                    try {
                        FileReceiver.saveCheckpoint(
                            checkpointPath,
                            checkpoint
                        );

                        console.log(
                            "Phase 4.4B: Interrupted file preserved:",
                            filePath
                        );

                        console.log(
                            "Phase 4.4B: Checkpoint:",
                            checkpointPath
                        );
                    } catch (error) {
                        console.error(
                            "Could not save interrupted checkpoint:",
                            error.message
                        );
                    }
                } else {
                    // Preserve original folder-sync cleanup behavior.
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