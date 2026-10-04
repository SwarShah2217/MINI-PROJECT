const HEADER_SIZE_BYTES = 4;

class ChunkProtocol {

    static createChunkFrame(chunkNumber, data, hash) {

        const metadata = {
            type: "CHUNK",
            chunkNumber,
            size: data.length,
            hash
        };

        const metadataBuffer =
            Buffer.from(JSON.stringify(metadata), "utf8");

        const lengthBuffer =
            Buffer.alloc(HEADER_SIZE_BYTES);

        lengthBuffer.writeUInt32BE(
            metadataBuffer.length,
            0
        );

        return Buffer.concat([
            lengthBuffer,
            metadataBuffer,
            data
        ]);
    }


    static createParser(onChunk) {

        let buffer = Buffer.alloc(0);

        return function parseData(data) {

            buffer = Buffer.concat([
                buffer,
                data
            ]);

            while (true) {

                if (buffer.length < HEADER_SIZE_BYTES) {
                    return;
                }

                const metadataLength =
                    buffer.readUInt32BE(0);

                if (
                    buffer.length <
                    HEADER_SIZE_BYTES + metadataLength
                ) {
                    return;
                }

                const metadataStart =
                    HEADER_SIZE_BYTES;

                const metadataEnd =
                    metadataStart + metadataLength;

                let metadata;

                try {

                    metadata = JSON.parse(
                        buffer
                            .subarray(
                                metadataStart,
                                metadataEnd
                            )
                            .toString("utf8")
                    );

                } catch (error) {

                    throw new Error(
                        `Invalid chunk metadata: ${error.message}`
                    );
                }

                if (
                    metadata.type !== "CHUNK" ||
                    !Number.isInteger(metadata.chunkNumber) ||
                    !Number.isInteger(metadata.size) ||
                    metadata.size < 0 ||
                    typeof metadata.hash !== "string"
                ) {
                    throw new Error(
                        "Invalid chunk metadata"
                    );
                }

                const completeFrameLength =
                    metadataEnd + metadata.size;

                if (buffer.length < completeFrameLength) {
                    return;
                }

                const chunkData =
                    buffer.subarray(
                        metadataEnd,
                        completeFrameLength
                    );

                buffer =
                    buffer.subarray(
                        completeFrameLength
                    );

                onChunk(
                    metadata,
                    Buffer.from(chunkData)
                );
            }
        };
    }
}

module.exports = ChunkProtocol;