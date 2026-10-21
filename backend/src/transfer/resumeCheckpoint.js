const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const CHUNK_SIZE = 64 * 1024;

function checkpointPathFor(transferId) {
    if (typeof transferId !== "string" || !transferId) {
        throw new Error("Invalid transfer ID");
    }

    const name = crypto
        .createHash("sha256")
        .update(transferId)
        .digest("hex") + ".json";

    return path.join(
        __dirname,
        "../../downloads/.checkpoints",
        name
    );
}

function verifyCheckpoint(transferId, expected = {}) {
    const checkpointPath = checkpointPathFor(transferId);

    if (!fs.existsSync(checkpointPath)) {
        return null;
    }

    const checkpoint = JSON.parse(
        fs.readFileSync(checkpointPath, "utf8")
    );

    if (
        checkpoint.version !== 1 ||
        checkpoint.transferId !== transferId ||
        checkpoint.chunkSize !== CHUNK_SIZE ||
        !Number.isSafeInteger(checkpoint.fileSize) ||
        checkpoint.fileSize < 0 ||
        !checkpoint.verifiedChunks ||
        typeof checkpoint.verifiedChunks !== "object" ||
        Array.isArray(checkpoint.verifiedChunks)
    ) {
        throw new Error("Invalid resume checkpoint");
    }

    if (
        expected.fileName !== undefined &&
        checkpoint.fileName !== path.basename(expected.fileName)
    ) {
        throw new Error("Resume filename mismatch");
    }

    if (
        expected.fileSize !== undefined &&
        checkpoint.fileSize !== expected.fileSize
    ) {
        throw new Error("Resume file size mismatch");
    }

    if (
        expected.fileHash !== undefined &&
        checkpoint.fileHash !== expected.fileHash
    ) {
        throw new Error("Resume file hash mismatch");
    }

    const downloadsRoot = path.resolve(
        __dirname,
        "../../downloads"
    );

    const expectedFilePath = path.join(
        downloadsRoot,
        `${transferId}-${path.basename(checkpoint.fileName)}`
    );

    if (
        path.resolve(checkpoint.filePath) !==
        path.resolve(expectedFilePath)
    ) {
        throw new Error("Resume checkpoint path mismatch");
    }

    const stats = fs.statSync(expectedFilePath);

    if (!stats.isFile()) {
        throw new Error("Partial download is not a file");
    }

    const fd = fs.openSync(expectedFilePath, "r");

    let verifiedBytes = 0;
    let nextChunk = 0;

    try {
        while (verifiedBytes < checkpoint.fileSize) {
            const record =
                checkpoint.verifiedChunks[String(nextChunk)];

            if (!record) break;

            const expectedSize = Math.min(
                CHUNK_SIZE,
                checkpoint.fileSize - verifiedBytes
            );

            if (
                record.size !== expectedSize ||
                typeof record.hash !== "string" ||
                !/^[a-f0-9]{64}$/i.test(record.hash) ||
                stats.size < verifiedBytes + expectedSize
            ) {
                break;
            }

            const buffer = Buffer.alloc(expectedSize);

            const bytesRead = fs.readSync(
                fd,
                buffer,
                0,
                expectedSize,
                verifiedBytes
            );

            if (bytesRead !== expectedSize) break;

            const actualHash = crypto
                .createHash("sha256")
                .update(buffer)
                .digest("hex");

            if (
                actualHash.toLowerCase() !==
                record.hash.toLowerCase()
            ) {
                break;
            }

            verifiedBytes += expectedSize;
            nextChunk++;
        }
    } finally {
        fs.closeSync(fd);
    }

    return {
        transferId,
        checkpointPath,
        filePath: expectedFilePath,
        fileName: checkpoint.fileName,
        fileSize: checkpoint.fileSize,
        fileHash: checkpoint.fileHash,
        verifiedBytes,
        nextChunk,
        complete: verifiedBytes === checkpoint.fileSize
    };
}

module.exports = {
    checkpointPathFor,
    verifyCheckpoint
};
