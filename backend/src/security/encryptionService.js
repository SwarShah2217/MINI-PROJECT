const crypto = require("crypto");

class EncryptionService {

    static generateKey() {

        return crypto.randomBytes(32);
    }


    static encryptBuffer(buffer, key) {

        if (!Buffer.isBuffer(buffer)) {
            throw new TypeError(
                "encryptBuffer expects a Buffer"
            );
        }

        if (
            !Buffer.isBuffer(key) ||
            key.length !== 32
        ) {
            throw new TypeError(
                "AES-256-GCM key must be a 32-byte Buffer"
            );
        }


        const iv =
            crypto.randomBytes(12);


        const cipher =
            crypto.createCipheriv(
                "aes-256-gcm",
                key,
                iv
            );


        const encryptedData =
            Buffer.concat([
                cipher.update(buffer),
                cipher.final()
            ]);


        const authTag =
            cipher.getAuthTag();


        return {
            encryptedData,
            iv,
            authTag
        };
    }


    static decryptBuffer(
        encryptedData,
        key,
        iv,
        authTag
    ) {

        if (!Buffer.isBuffer(encryptedData)) {
            throw new TypeError(
                "decryptBuffer expects encryptedData to be a Buffer"
            );
        }

        if (
            !Buffer.isBuffer(key) ||
            key.length !== 32
        ) {
            throw new TypeError(
                "AES-256-GCM key must be a 32-byte Buffer"
            );
        }

        if (
            !Buffer.isBuffer(iv) ||
            iv.length !== 12
        ) {
            throw new TypeError(
                "AES-GCM IV must be a 12-byte Buffer"
            );
        }

        if (
            !Buffer.isBuffer(authTag) ||
            authTag.length !== 16
        ) {
            throw new TypeError(
                "AES-GCM auth tag must be a 16-byte Buffer"
            );
        }


        const decipher =
            crypto.createDecipheriv(
                "aes-256-gcm",
                key,
                iv
            );


        decipher.setAuthTag(
            authTag
        );


        return Buffer.concat([
            decipher.update(
                encryptedData
            ),
            decipher.final()
        ]);
    }
}

module.exports = EncryptionService;