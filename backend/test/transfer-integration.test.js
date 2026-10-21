const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const crypto = require("node:crypto");
const { load, Socket, memoryFs } = require("./helpers");
const HashService = require("../src/integrity/hashService");
const ChunkProtocol = require("../src/transfer/chunkProtocol");
const tick = () => new Promise(setImmediate);

// Production sender, server, receiver, chunk framing, AES-GCM, compression and
// checkpoint verification are connected through event emitters, with all file
// operations confined to a memory map. No LAN sockets or real transfer files.
test("production modules recover an interrupted transfer and verify the complete file", async () => {
    const fs = memoryFs();
    const hash = { hashBuffer: HashService.hashBuffer, hashesMatch: HashService.hashesMatch,
        hashFile: file => Promise.resolve(HashService.hashBuffer(fs.files.get(path.resolve(file)))) };
    const resume = load("src/transfer/resumeCheckpoint.js", { fs });
    const Receiver = load("src/transfer/fileReceiver.js", { fs, "../integrity/hashService": hash });
    let accept;
    const Server = load("src/transfer/fileTransferServer.js", {
        net: { createServer: callback => { accept = callback; return {}; } },
        "./fileReceiver": Receiver, "./resumeCheckpoint": resume
    });
    const id = crypto.randomUUID();
    const encryptionKey = crypto.randomBytes(32);
    const receiverState = { sessionKeyManager: { getSessionKey: () => encryptionKey } };
    const server = new Server(receiverState);
    const data = crypto.randomBytes(65536 * 3 + 91);
    // Include compressible and incompressible chunks in the same test.
    data.fill(7, 65536, 131072);
    const source = path.resolve(__dirname, "../temp", `${id}-integration.bin`);
    fs.writeFileSync(source, data);
    let dropAfterFirst = true;
    let senderSocket;
    const Manager = load("src/transfer/transferManager.js", {
        fs, "../integrity/hashService": hash,
        net: { createConnection(options, connected) {
            senderSocket = new Socket();
            const receivingSocket = new Socket();
            senderSocket.write = bytes => {
                setImmediate(() => { if (!receivingSocket.destroyed) receivingSocket.emit("data", Buffer.from(bytes)); });
                return true;
            };
            receivingSocket.write = bytes => {
                const response = JSON.parse(bytes);
                setImmediate(() => {
                    if (dropAfterFirst && response.type === "CHUNK_ACK") {
                        dropAfterFirst = false;
                        receivingSocket.destroy();
                        senderSocket.destroy();
                    } else if (!senderSocket.destroyed) senderSocket.emit("data", Buffer.from(bytes));
                });
                return true;
            };
            senderSocket.on("close", () => receivingSocket.destroy());
            accept(receivingSocket);
            setImmediate(connected);
            return senderSocket;
        } }
    });
    const manager = new Manager({ status: "connected", socket: new Socket() });
    const transfer = { transferId: id, fileName: "integration.bin", filePath: source, fileSize: data.length };
    manager.activeTransfer = transfer;
    manager.sessionKeyManager.storeSessionKey(id, encryptionKey);
    const first = await manager.connectForFileTransfer("memory-peer");
    manager.sendFile(first);
    for (let index = 0; index < 30 && manager.activeTransfer; index++) await tick();
    assert.equal(manager.lastTransfer.status, "interrupted");
    const checkpoint = resume.verifyCheckpoint(id);
    assert.equal(checkpoint.verifiedBytes, 65536);
    assert.equal(server.activeTransferIds.size, 0);

    assert.equal(manager.queueInterruptedTransfer(id, "integration.bin", data.length), true);
    manager.sessionKeyManager.storeSessionKey(id, encryptionKey);
    const second = await manager.connectForFileTransfer("memory-peer");
    manager.sendFile(second, true);
    for (let index = 0; index < 100 && manager.activeTransfer; index++) await tick();
    await tick();
    assert.equal(manager.lastTransfer.status, "completed");
    assert.equal(server.activeTransferIds.size, 0);
    assert.equal(receiverState.incomingTransfer.status, "completed");
    assert.deepEqual(fs.files.get(checkpoint.filePath), data);
    assert.deepEqual(fs.files.get(source), data);
    assert.equal(fs.handles.size, 0);
});

test("complete checkpoint is rehashed after restart without retransmitting chunks", async () => {
    const fs = memoryFs();
    const data = Buffer.from("short final chunk");
    const id = crypto.randomUUID();
    const hash = HashService.hashBuffer(data);
    const resume = load("src/transfer/resumeCheckpoint.js", { fs });
    const filename = path.resolve(__dirname, "../downloads", `${id}-complete.bin`);
    fs.writeFileSync(filename, data);
    fs.writeFileSync(resume.checkpointPathFor(id), JSON.stringify({ version: 1, transferId: id,
        fileName: "complete.bin", fileSize: data.length, fileHash: hash, filePath: filename,
        chunkSize: 65536, verifiedChunks: { 0: { hash, size: data.length } } }));
    const state = resume.verifyCheckpoint(id);
    assert.equal(state.complete, true);
    const Receiver = load("src/transfer/fileReceiver.js", { fs,
        "../integrity/hashService": { ...HashService, hashesMatch: HashService.hashesMatch, hashFile: async () => hash } });
    const socket = new Socket();
    let finalized = false;
    new Receiver().receiveFile(socket, "complete.bin", data.length, id, hash, null,
        false, null, null, state, () => { finalized = true; });
    await tick();
    assert.equal(finalized, true);
    assert.equal(socket.messages().at(-1).type, "FILE_TRANSFER_COMPLETE");
    assert.deepEqual(fs.files.get(filename), data);
});

test("folder sync waits for interrupted-file cleanup before releasing its ID", async () => {
    const fs = memoryFs();
    const Receiver = load("src/transfer/fileReceiver.js", { fs });
    const socket = new Socket();
    let finalized = 0;
    const destination = path.resolve("memory-folder-fixture");
    new Receiver().receiveFile(socket, "folder.bin", 3, crypto.randomUUID(), "a".repeat(64),
        null, true, "sub/folder.bin", destination, null, () => finalized++);
    socket.destroy();
    assert.equal(finalized, 0);
    await tick();
    assert.equal(finalized, 1);
    assert.equal(fs.files.size, 0);
    assert.equal(fs.handles.size, 0);
});

test("receiver handles short filesystem writes without checkpointing missing bytes", async () => {
    const fs = memoryFs();
    const write = fs.writeSync;
    fs.writeSync = (fd, data, offset, length, position) => write(fd, data, offset, Math.min(length, 2), position);
    const data = Buffer.from("short writes");
    const hash = HashService.hashBuffer(data);
    const Receiver = load("src/transfer/fileReceiver.js", { fs,
        "../integrity/hashService": { hashBuffer: HashService.hashBuffer, hashesMatch: HashService.hashesMatch,
            hashFile: async name => HashService.hashBuffer(fs.files.get(path.resolve(name))) } });
    const socket = new Socket();
    new Receiver().receiveFile(socket, "short.bin", data.length, crypto.randomUUID(), hash, null);
    socket.emit("data", ChunkProtocol.createChunkFrame(0, data, hash));
    await tick();
    assert.equal(socket.messages().at(-1).type, "FILE_TRANSFER_COMPLETE");
    assert.deepEqual([...fs.files.values()][0], data);
});
