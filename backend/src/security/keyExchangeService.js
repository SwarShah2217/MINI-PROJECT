const crypto = require("crypto");


class KeyExchangeService {

    static createKeyPair() {

        const ecdh =
            crypto.createECDH(
                "prime256v1"
            );


        ecdh.generateKeys();


        return {
            ecdh,
            publicKey:
                ecdh
                    .getPublicKey()
                    .toString("base64")
        };
    }


    static deriveSessionKey(
        ecdh,
        peerPublicKey
    ) {

        if (!ecdh) {

            throw new Error(
                "ECDH instance is required"
            );
        }


        if (
            !peerPublicKey ||
            typeof peerPublicKey !== "string"
        ) {

            throw new Error(
                "Peer public key is required"
            );
        }


        const peerKeyBuffer =
            Buffer.from(
                peerPublicKey,
                "base64"
            );


        const sharedSecret =
            ecdh.computeSecret(
                peerKeyBuffer
            );


        return crypto
            .createHash("sha256")
            .update(sharedSecret)
            .digest();
    }
}


module.exports =
    KeyExchangeService;