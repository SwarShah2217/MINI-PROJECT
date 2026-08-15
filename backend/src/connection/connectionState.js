class ConnectionState {

    constructor() {
        this.status = "disconnected";
        this.peerIp = null;
        this.socket = null;
    }

    setConnecting(ip) {
        this.status = "connecting";
        this.peerIp = ip;
        this.socket = null;
    }

    setPending(ip, socket) {
        this.status = "pending";
        this.peerIp = ip;
        this.socket = socket;
    }

    setConnected(ip, socket) {
        this.status = "connected";
        this.peerIp = ip;
        this.socket = socket;
    }

    reset() {
        this.status = "disconnected";
        this.peerIp = null;
        this.socket = null;
    }

    getStatus() {
        return {
            status: this.status,
            connected: this.status === "connected",
            peerIp: this.peerIp
        };
    }
}

module.exports = ConnectionState;