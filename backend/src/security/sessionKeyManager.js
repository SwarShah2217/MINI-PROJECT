const EncryptionService =
    require("./encryptionService");


class SessionKeyManager {

    constructor() {

        this.sessionKeys =
            new Map();
    }


    createSessionKey(transferId) {

        if (!transferId) {

            throw new Error(
                "transferId is required"
            );
        }


        const key =
            EncryptionService.generateKey();


        this.sessionKeys.set(
            transferId,
            key
        );


        return key;
    }


    storeSessionKey(
        transferId,
        key
    ) {

        if (!transferId) {

            throw new Error(
                "transferId is required"
            );
        }


        if (
            !Buffer.isBuffer(key) ||
            key.length !== 32
        ) {

            throw new TypeError(
                "Session key must be a 32-byte Buffer"
            );
        }


        this.sessionKeys.set(
            transferId,
            key
        );
    }


    getSessionKey(transferId) {

        return (
            this.sessionKeys.get(
                transferId
            ) || null
        );
    }


    hasSessionKey(transferId) {

        return this.sessionKeys.has(
            transferId
        );
    }


    removeSessionKey(transferId) {

        return this.sessionKeys.delete(
            transferId
        );
    }
}


module.exports =
    SessionKeyManager;