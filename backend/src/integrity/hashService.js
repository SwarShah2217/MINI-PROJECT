const crypto = require("crypto");
const fs = require("fs");

class HashService {

    /**
     * Calculate SHA-256 for a Buffer.
     *
     * This will be used for individual 64 KB chunks
     * during file transfer.
     */
    static hashBuffer(buffer) {

        if (!Buffer.isBuffer(buffer)) {
            throw new TypeError(
                "hashBuffer expects a Buffer"
            );
        }

        return crypto
            .createHash("sha256")
            .update(buffer)
            .digest("hex");
    }


    /**
     * Calculate SHA-256 for an entire file.
     *
     * The file is streamed instead of loading the
     * entire file into RAM.
     *
     * This will later be used for:
     * 1. Final file integrity verification
     * 2. Folder synchronization
     */
    static hashFile(filePath) {

        return new Promise((resolve, reject) => {

            const hash =
                crypto.createHash("sha256");

            const stream =
                fs.createReadStream(filePath);

            stream.on("data", (chunk) => {
                hash.update(chunk);
            });

            stream.on("end", () => {

                const fileHash =
                    hash.digest("hex");

                resolve(fileHash);
            });

            stream.on("error", (error) => {
                reject(error);
            });
        });
    }


    /**
     * Compare two SHA-256 hashes.
     */
    static hashesMatch(expectedHash, actualHash) {

        if (!expectedHash || !actualHash) {
            return false;
        }

        return expectedHash === actualHash;
    }
}

module.exports = HashService;