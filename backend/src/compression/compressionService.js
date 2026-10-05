const zlib = require("zlib");


class CompressionService {

    static compressBuffer(buffer) {

        if (!Buffer.isBuffer(buffer)) {

            throw new TypeError(
                "compressBuffer expects a Buffer"
            );
        }


        return zlib.gzipSync(
            buffer
        );
    }


    static decompressBuffer(buffer) {

        if (!Buffer.isBuffer(buffer)) {

            throw new TypeError(
                "decompressBuffer expects a Buffer"
            );
        }


        return zlib.gunzipSync(
            buffer
        );
    }
}


module.exports =
    CompressionService;