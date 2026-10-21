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
        destinationPath = null,
        resumeState = null,
        onFinalized = null,
        onProgress = null
    ) {

        // PHASE44B_RESUME_RECEIVER_V1
        // resumeState must be produced by verifyCheckpoint().
        if (resumeState) {
            if (
                isFolderSync ||
                resumeState.transferId !== transferId ||
                resumeState.fileName !== path.basename(fileName) ||
                resumeState.fileSize !== fileSize ||
                resumeState.fileHash !== fileHash ||
                !Number.isSafeInteger(resumeState.verifiedBytes) ||
                !Number.isSafeInteger(resumeState.nextChunk) ||
                resumeState.verifiedBytes < 0 ||
                resumeState.verifiedBytes > fileSize ||
                resumeState.nextChunk < 0 ||
                resumeState.nextChunk !== Math.ceil(resumeState.verifiedBytes / (64 * 1024)) ||
                (resumeState.verifiedBytes !== fileSize && resumeState.verifiedBytes % (64 * 1024) !== 0)
            ) {
                throw new Error("Invalid verified resume state");
            }
        }

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

        // Existing checkpoints require explicit, verified recovery.
        if (checkpointPath && fs.existsSync(checkpointPath) && !resumeState) {
            throw new Error(
                "An existing checkpoint was found for this transfer ID. " +
                "An explicit verified resume is required."
            );
        }

        if (resumeState) {
            if (
                !checkpointPath ||
                resumeState.checkpointPath !== checkpointPath ||
                path.resolve(resumeState.filePath) !== path.resolve(filePath) ||
                !fs.existsSync(checkpointPath)
            ) {
                throw new Error("Resume checkpoint does not match destination");
            }
        }

        const activeCheckpoint = resumeState
            ? JSON.parse(fs.readFileSync(checkpointPath, "utf8"))
            : checkpoint;

        // Never truncate a verified partial file.
        const fileDescriptor = fs.openSync(
            filePath,
            resumeState ? "r+" : (isFolderSync ? "w" : "wx")
        );

        let receivedBytes = resumeState
            ? resumeState.verifiedBytes
            : 0;
        let transferCompleted = false;
        // PHASE44B_RECEIVER_FINALIZATION_SIGNAL_V1
        let finalizationSignaled = false;
        const reportProgress = (status) => {
            if (typeof onProgress === "function") {
                onProgress({ status, receivedBytes });
            }
        };

        const signalFinalized = () => {
            if (finalizationSignaled) return;
            finalizationSignaled = true;

            if (typeof onFinalized === "function") {
                onFinalized();
            }
        };

        try {
            if (activeCheckpoint) {
                if (resumeState) {
                    // Retain only the contiguous chunks independently verified
                    // by resumeCheckpoint.js.
                    const verifiedChunks = {};
                    for (let index = 0; index < resumeState.nextChunk; index++) {
                        verifiedChunks[String(index)] =
                            activeCheckpoint.verifiedChunks[String(index)];
                    }
                    activeCheckpoint.verifiedChunks = verifiedChunks;
                    activeCheckpoint.verifiedBytes = receivedBytes;
                    activeCheckpoint.status = "receiving";
                    activeCheckpoint.updatedAt = new Date().toISOString();
                }

                FileReceiver.saveCheckpoint(checkpointPath, activeCheckpoint);
            }
        } catch (error) {
            // The server may release the ID after this synchronous failure.
            // Close first so a retry cannot race an abandoned descriptor.
            fs.closeSync(fileDescriptor);
            throw error;
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

            // Only accept the next expected chunk. This prevents
            // duplicate/out-of-order frames from corrupting resume state.
            const expectedChunk = Math.floor(
                receivedBytes / (64 * 1024)
            );

            if (
                !Number.isSafeInteger(metadata.chunkNumber) ||
                metadata.chunkNumber !== expectedChunk ||
                dataToVerify.length !== Math.min(
                    64 * 1024,
                    fileSize - receivedBytes
                )
            ) {
                console.error(
                    "Unexpected chunk during transfer:",
                    metadata.chunkNumber,
                    "expected:",
                    expectedChunk
                );
                socket.destroy();
                return;
            }

            let written = 0;
            while (written < dataToVerify.length) {
                const count = fs.writeSync(fileDescriptor, dataToVerify, written,
                    dataToVerify.length - written, chunkPosition + written);
                if (count <= 0) throw new Error("Could not write complete chunk");
                written += count;
            }

            receivedBytes +=
                dataToVerify.length;


            if (activeCheckpoint) {
                // Ensure the verified bytes reach the file before
                // recording them in the persistent checkpoint.
                fs.fsyncSync(fileDescriptor);

                activeCheckpoint.verifiedChunks[
                    String(metadata.chunkNumber)
                ] = {
                    size: dataToVerify.length,
                    hash: calculatedHash
                };

                activeCheckpoint.verifiedBytes = receivedBytes;
                activeCheckpoint.updatedAt =
                    new Date().toISOString();

                FileReceiver.saveCheckpoint(checkpointPath, activeCheckpoint);
            }
            reportProgress("receiving");

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
            reportProgress("verifying");

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


                // PHASE44B_PRESERVE_INTEGRITY_FAILURE_V1
                if (!fileValid) {
                    reportProgress("integrity_failed");
                    console.error(
                        "FINAL FILE SHA-256 VERIFICATION FAILED"
                    );

                    if (activeCheckpoint) {
                        // Preserve the file and checkpoint for investigation.
                        // Do not label the file as successfully verified.
                        activeCheckpoint.status = "integrity_failed";
                        activeCheckpoint.updatedAt = new Date().toISOString();

                        FileReceiver.saveCheckpoint(
                            checkpointPath,
                            activeCheckpoint
                        );

                        console.error(
                            "Failed-integrity file and checkpoint preserved:",
                            filePath
                        );
                    } else {
                        // Preserve the original non-checkpoint transfer behavior.
                        await new Promise((resolve) => {
                            fs.unlink(filePath, (error) => {
                                if (error) console.error("Could not delete failed file:", error.message);
                                resolve();
                            });
                        });
                    }

                    if (!socket.destroyed) {
                        socket.write(
                            JSON.stringify({
                                type: "FILE_INTEGRITY_FAILED"
                            }) + "\n"
                        );
                    }

                    return;
                }


                console.log(
                    "FINAL FILE SHA-256 VERIFIED"
                );

                FileReceiver.removeCheckpoint(
                    checkpointPath
                );
                reportProgress("completed");


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
                reportProgress("interrupted");

                socket.destroy();
            } finally {
                // PHASE44B_FINAL_HASH_SETTLED_V1
                // Signal only after SHA-256 verification and
                // its success/failure handling have finished.
                signalFinalized();
            }
        }

        const handleIncomplete = () => {
            if (transferCompleted) {
                return;
            }

            if (!transferCompleted) {

                transferCompleted = true;
                socket.removeListener("data", handleData);
                reportProgress("interrupted");

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


                if (activeCheckpoint) {
                    activeCheckpoint.status = "interrupted";
                    activeCheckpoint.updatedAt =
                        new Date().toISOString();

                    try {
                        FileReceiver.saveCheckpoint(checkpointPath, activeCheckpoint);

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
                            signalFinalized();
                        }
                    );
                    return;
                }
            }
            // PHASE44B_INTERRUPTED_FINALIZATION_SIGNAL_V1
            // The file descriptor and checkpoint cleanup have
            // finished before the transfer lock can be released.
            signalFinalized();
        };


        socket.on(
            "data",
            handleData
        );


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

        // Install cleanup handlers before processing coalesced header/chunk data.
        reportProgress("receiving");
        if (fileSize === receivedBytes) {
            completeTransfer();
        } else if (initialData && initialData.length > 0) {
            handleData(initialData);
        }
    }
}

module.exports = FileReceiver;
