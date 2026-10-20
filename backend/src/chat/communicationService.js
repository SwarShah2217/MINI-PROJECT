
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

class CommunicationService {
    constructor(connectionState) {
        this.connectionState = connectionState;
        this.directory = path.join(__dirname, "../../data");
        this.file = path.join(this.directory, "phase42.json");

        fs.mkdirSync(this.directory, { recursive: true });

        try {
            this.data = JSON.parse(fs.readFileSync(this.file, "utf8"));
        } catch {
            this.data = { messages: [], activity: [] };
        }

        if (!Array.isArray(this.data.messages)) this.data.messages = [];
        if (!Array.isArray(this.data.activity)) this.data.activity = [];
    }

    save() {
        this.data.messages = this.data.messages.slice(-500);
        this.data.activity = this.data.activity.slice(-500);

        const temp = this.file + ".tmp";
        fs.writeFileSync(temp, JSON.stringify(this.data, null, 2));
        fs.renameSync(temp, this.file);
    }

    addActivity(kind, details) {
        const item = {
            id: crypto.randomUUID(),
            kind,
            details: String(details).slice(0, 300),
            timestamp: new Date().toISOString()
        };
        this.data.activity.push(item);
        this.save();
        return item;
    }

    receive(message) {
        if (!message || message.type !== "LAN_CHAT") return;

        if (this.connectionState.status !== "connected") return;

        if (typeof message.text !== "string") return;

        const text = message.text.trim().slice(0, 2000);
        if (!text) return;

        const item = {
            id: crypto.randomUUID(),
            direction: "incoming",
            text,
            timestamp: new Date().toISOString()
        };

        this.data.messages.push(item);
        this.save();
    }

    send(text) {
        const socket = this.connectionState.socket;

        if (
            this.connectionState.status !== "connected" ||
            !socket ||
            socket.destroyed ||
            !socket.writable
        ) {
            return { success: false, error: "No active peer connection" };
        }

        if (typeof text !== "string" || !text.trim()) {
            return { success: false, error: "Message is empty" };
        }

        const clean = text.trim().slice(0, 2000);

        socket.write(JSON.stringify({
            type: "LAN_CHAT",
            text: clean
        }) + "\n");

        const item = {
            id: crypto.randomUUID(),
            direction: "outgoing",
            text: clean,
            timestamp: new Date().toISOString()
        };

        this.data.messages.push(item);
        this.save();

        return { success: true, message: item };
    }

    getMessages() {
        return this.data.messages.slice(-100);
    }

    getActivity() {
        return this.data.activity.slice(-100).reverse();
    }
}

module.exports = CommunicationService;
