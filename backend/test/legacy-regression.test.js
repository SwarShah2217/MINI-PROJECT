const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const path = require("node:path");
const { load, Socket, memoryFs } = require("./helpers");
const ConnectionState = require("../src/connection/connectionState");
const FolderComparator = require("../src/sync/folderComparator");
const HashService = require("../src/integrity/hashService");
const ChunkProtocol = require("../src/transfer/chunkProtocol");
const tick = () => new Promise(setImmediate);

function tcpFixture() {
    const TCP = load("src/connection/tcpServer.js", { net: { createServer: () => ({}) } });
    const state = new ConnectionState();
    const tcp = new TCP(state, { activeTransfer: null });
    function request(credential) {
        const socket = new Socket();
        socket.remoteAddress = "192.168.1.42";
        tcp.handleConnection(socket);
        socket.emit("data", Buffer.from(JSON.stringify({ type: "CONNECTION_REQUEST", phase44Credential: credential }) + "\n"));
        return socket;
    }
    return { state, tcp, request };
}

test("manual pairing still waits for acceptance", () => {
    const f = tcpFixture();
    const socket = f.request();
    assert.equal(f.state.status, "pending");
    assert.equal(socket.messages().length, 0);
    assert.equal(f.tcp.acceptConnection(), true);
    assert.equal(f.state.status, "connected");
    assert.equal(socket.messages().at(-1).type, "CONNECTION_ACCEPTED");
});

test("closing control connection clears a pending outgoing request", () => {
    const f = tcpFixture();
    const socket = f.request();
    f.tcp.acceptConnection();
    const transfer = { status: "pending", controlSocket: socket };
    f.tcp.transferManager.activeTransfer = transfer;
    let finished;
    f.tcp.transferManager.finishTransfer = (status, current) => { finished = { status, current }; };
    socket.destroy();
    assert.equal(f.state.status, "disconnected");
    assert.equal(finished.status, "interrupted");
    assert.equal(finished.current, transfer);
});

test("PIN and QR credentials accept once and expire", () => {
    for (const kind of ["pin", "qr"]) {
        const f = tcpFixture();
        const pin = "123456";
        const token = crypto.randomBytes(32).toString("hex");
        const credential = { kind, value: kind === "pin" ? pin : token };
        f.tcp.phase44Pair = { pin, token, expires: Date.now() + 60000 };
        const socket = f.request(credential);
        assert.equal(socket.messages().at(-1).type, "CONNECTION_ACCEPTED");
        assert.equal(f.tcp.phase44Pair, null);
        socket.destroy();
        const reused = f.request(credential);
        assert.equal(reused.messages().at(-1).type, "CONNECTION_REJECTED");
        f.tcp.phase44Pair = { pin, token, expires: Date.now() - 1 };
        assert.equal(f.request(credential).messages().at(-1).type, "CONNECTION_REJECTED");
    }
});

test("QR encoder payload remains readable by the bundled browser decoder", () => {
    const QRCode = require("qrcode");
    const jsQR = require("jsqr");
    const text = JSON.stringify({ app: "SyncLAN", version: 1, ip: "192.168.1.42", token: "a".repeat(64) });
    const qr = QRCode.create(text, { errorCorrectionLevel: "M" });
    const scale = 6;
    const margin = 4;
    const width = (qr.modules.size + margin * 2) * scale;
    const pixels = new Uint8ClampedArray(width * width * 4).fill(255);
    for (let y = 0; y < width; y++) {
        for (let x = 0; x < width; x++) {
            const row = Math.floor(y / scale) - margin;
            const column = Math.floor(x / scale) - margin;
            if (row >= 0 && column >= 0 && row < qr.modules.size && column < qr.modules.size && qr.modules.get(row, column)) {
                const offset = (y * width + x) * 4;
                pixels[offset] = pixels[offset + 1] = pixels[offset + 2] = 0;
            }
        }
    }
    assert.equal(jsQR(pixels, width, width).data, text);
});

test("chat send/receive and activity persist with the existing wire protocol", () => {
    const fs = memoryFs();
    const Communication = load("src/chat/communicationService.js", { fs });
    const socket = new Socket();
    socket.writable = true;
    const chat = new Communication({ status: "connected", socket });
    assert.equal(chat.send(" hello LAN ").success, true);
    chat.receive(socket.messages().at(-1));
    chat.addActivity("test", "fixture");
    assert.equal(chat.getMessages().length, 2);
    assert.equal(chat.getMessages()[1].text, "hello LAN");
    const reloaded = new Communication({ status: "connected", socket });
    assert.equal(reloaded.getMessages().length, 2);
    assert.equal(reloaded.getActivity().at(-1).details, "fixture");
});

test("folder comparison preserves new/modified/unchanged classifications", () => {
    const result = FolderComparator.compareFolders([
        { relativePath: "new.txt", hash: "a" },
        { relativePath: "modified.txt", hash: "b" },
        { relativePath: "same.txt", hash: "c" }
    ], [{ relativePath: "modified.txt", hash: "old" }, { relativePath: "same.txt", hash: "c" }]);
    assert.deepEqual(result.newFiles.map(f => f.relativePath), ["new.txt"]);
    assert.deepEqual(result.modifiedFiles.map(f => f.relativePath), ["modified.txt"]);
    assert.deepEqual(result.unchangedFiles.map(f => f.relativePath), ["same.txt"]);
});

test("folder receiver preserves destination layout and verifies success", async () => {
    const fs = memoryFs();
    const data = Buffer.from("folder content");
    const hash = HashService.hashBuffer(data);
    const Receiver = load("src/transfer/fileReceiver.js", { fs,
        "../integrity/hashService": { hashBuffer: HashService.hashBuffer, hashesMatch: HashService.hashesMatch,
            hashFile: async filename => HashService.hashBuffer(fs.files.get(path.resolve(filename))) } });
    const socket = new Socket();
    const destination = path.resolve("memory-folder-success");
    new Receiver().receiveFile(socket, "fixture.txt", data.length, crypto.randomUUID(), hash, null,
        true, "sub/fixture.txt", destination);
    socket.emit("data", ChunkProtocol.createChunkFrame(0, data, hash));
    await tick();
    assert.equal(socket.messages().at(-1).type, "FILE_TRANSFER_COMPLETE");
    assert.deepEqual(fs.files.get(path.join(destination, "sub/fixture.txt")), data);
    assert.equal([...fs.files.keys()].some(filename => filename.endsWith(".json")), false);
    assert.throws(() => new Receiver().receiveFile(new Socket(), "escape", 1, crypto.randomUUID(), hash,
        null, true, "../escape", destination), /Invalid folder sync relative path/);
});
