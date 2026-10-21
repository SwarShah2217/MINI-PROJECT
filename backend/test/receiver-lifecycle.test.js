const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const crypto = require("node:crypto");
const { load, Socket, memoryFs } = require("./helpers");
const ChunkProtocol = require("../src/transfer/chunkProtocol");
const HashService = require("../src/integrity/hashService");
const EncryptionService = require("../src/security/encryptionService");
const CompressionService = require("../src/compression/compressionService");
const id = "11111111-1111-4111-8111-111111111111";
const tick = () => new Promise(setImmediate);

function fixture(hashFile) {
    const fs = memoryFs();
    const hashes = { hashBuffer: HashService.hashBuffer, hashesMatch: HashService.hashesMatch,
        hashFile: hashFile || (name => Promise.resolve(HashService.hashBuffer(fs.files.get(path.resolve(name))))) };
    const Receiver = load("src/transfer/fileReceiver.js", { fs, "../integrity/hashService": hashes });
    return { fs, Receiver, receiver: new Receiver(), socket: new Socket() };
}

function receive(f, data, finalized = () => {}) {
    f.receiver.receiveFile(f.socket, "fixture.bin", data.length, id,
        HashService.hashBuffer(data), Buffer.alloc(0), false, null, null, null, finalized);
}

const header = () => ({ transferId: id, fileName: "fixture.bin", fileSize: 1, fileHash: "a".repeat(64) });

function frame(index, data) {
    return ChunkProtocol.createChunkFrame(index, data, HashService.hashBuffer(data));
}

test("server retains ID until BOTH socket close and receiver finalization, in either order", () => {
    for (const closeFirst of [true, false]) {
        let accept, finalized;
        class Receiver {
            receiveFile(...args) { finalized = args[10]; }
        }
        const Server = load("src/transfer/fileTransferServer.js", {
            net: { createServer: cb => { accept = cb; return {}; } },
            "./fileReceiver": Receiver
        });
        const server = new Server({ sessionKeyManager: { getSessionKey: () => Buffer.alloc(32) } });
        const socket = new Socket();
        accept(socket);
        socket.emit("data", Buffer.from(JSON.stringify(header()) + "\n"));
        assert.equal(typeof finalized, "function");
        if (closeFirst) socket.destroy(); else finalized();
        assert.equal(server.activeTransferIds.has(id), true);
        // A second connection must not take the same ID during cleanup/hash.
        const duplicate = new Socket();
        accept(duplicate);
        duplicate.emit("data", Buffer.from(JSON.stringify(header()) + "\n"));
        assert.equal(duplicate.destroyed, true);
        assert.equal(server.activeTransferIds.has(id), true);
        if (closeFirst) finalized(); else socket.destroy();
        finalized();
        assert.equal(server.activeTransferIds.size, 0);
    }
});

test("server releases ID on synchronous receiver initialization failure", () => {
    let accept;
    const Server = load("src/transfer/fileTransferServer.js", {
        net: { createServer: cb => { accept = cb; return {}; } },
        "./fileReceiver": class { receiveFile() { throw Error("disk full"); } }
    });
    const server = new Server({ sessionKeyManager: { getSessionKey: () => Buffer.alloc(32) } });
    const socket = new Socket();
    accept(socket);
    socket.emit("data", Buffer.from(JSON.stringify(header()) + "\n"));
    assert.equal(socket.destroyed, true);
    assert.equal(server.activeTransferIds.size, 0);
});

test("receiver closes descriptor if initial checkpoint persistence fails", () => {
    const f = fixture();
    f.Receiver.saveCheckpoint = () => { throw Error("disk full"); };
    assert.throws(() => receive(f, Buffer.from("data")), /disk full/);
    assert.equal(f.fs.handles.size, 0);
});

test("socket close during final hash does not signal early, and finalizes exactly once", async () => {
    let resolveHash;
    const data = Buffer.from("data");
    const f = fixture(() => new Promise(resolve => { resolveHash = resolve; }));
    let finalized = 0;
    receive(f, data, () => finalized++);
    f.socket.emit("data", frame(0, data));
    f.socket.destroy();
    assert.equal(finalized, 0);
    assert.equal(f.fs.handles.size, 0);
    resolveHash(HashService.hashBuffer(data));
    await tick();
    assert.equal(finalized, 1);
    f.socket.emit("end");
    assert.equal(finalized, 1);
});

test("interruption preserves checkpoint and bytes; read-only verification finds contiguous prefix", () => {
    const f = fixture();
    const data = Buffer.alloc(65536 * 2, 7);
    let finalized = 0;
    receive(f, data, () => finalized++);
    f.socket.emit("data", frame(0, data.subarray(0, 65536)));
    f.socket.destroy();
    f.socket.emit("end");
    assert.equal(finalized, 1);
    assert.equal(f.fs.handles.size, 0);
    const resume = load("src/transfer/resumeCheckpoint.js", { fs: f.fs });
    const before = [...f.fs.files].map(([name, bytes]) => [name, bytes.toString("hex")]);
    const verified = resume.verifyCheckpoint(id, { fileSize: data.length });
    assert.equal(verified.verifiedBytes, 65536);
    assert.equal(verified.nextChunk, 1);
    assert.deepEqual([...f.fs.files].map(([name, bytes]) => [name, bytes.toString("hex")]), before);
});

test("resume uses verified offset and completes compressed/encrypted transfer", async () => {
    const f = fixture();
    const data = Buffer.alloc(65536 + 123, 9);
    receive(f, data);
    f.socket.emit("data", frame(0, data.subarray(0, 65536)));
    f.socket.destroy();
    const resume = load("src/transfer/resumeCheckpoint.js", { fs: f.fs });
    const state = resume.verifyCheckpoint(id, { fileHash: HashService.hashBuffer(data) });
    const socket = new Socket();
    const receiver = new f.Receiver();
    receiver.encryptionKey = crypto.randomBytes(32);
    let finalized = 0;
    receiver.receiveFile(socket, "fixture.bin", data.length, id, HashService.hashBuffer(data),
        null, false, null, null, state, () => finalized++);
    const encrypted = EncryptionService.encryptBuffer(CompressionService.compressBuffer(data.subarray(65536)), receiver.encryptionKey);
    const chunk = ChunkProtocol.createChunkFrame(1, encrypted.encryptedData, HashService.hashBuffer(data.subarray(65536)), encrypted.iv, encrypted.authTag, true);
    // Fragment the frame to exercise TCP reassembly.
    socket.emit("data", chunk.subarray(0, 5));
    socket.emit("data", chunk.subarray(5));
    await tick();
    assert.equal(finalized, 1);
    assert.deepEqual(f.fs.files.get(state.filePath), data);
    assert.equal(f.fs.existsSync(state.checkpointPath), false);
    assert.equal(socket.messages().at(-1).type, "FILE_TRANSFER_COMPLETE");
});

test("failed final hash preserves regular file and checkpoint", async () => {
    const f = fixture(() => Promise.resolve("0".repeat(64)));
    const data = Buffer.from("data");
    let finalized = 0;
    receive(f, data, () => finalized++);
    f.socket.emit("data", frame(0, data));
    await tick();
    assert.equal(finalized, 1);
    const checkpoint = [...f.fs.files].find(([name]) => name.endsWith(".json"));
    assert.equal(JSON.parse(checkpoint[1]).status, "integrity_failed");
    assert.equal(f.socket.messages().at(-1).type, "FILE_INTEGRITY_FAILED");
});

test("empty file completes and regular download never overwrites an existing file", async () => {
    const f = fixture();
    receive(f, Buffer.alloc(0));
    await tick();
    assert.equal(f.socket.messages().at(-1).type, "FILE_TRANSFER_COMPLETE");
    assert.throws(() => receive(f, Buffer.from("new")), /EEXIST/);
});

test("out-of-order chunks abort without writing data", () => {
    const f = fixture();
    receive(f, Buffer.alloc(131072));
    f.socket.emit("data", frame(1, Buffer.alloc(65536)));
    assert.equal(f.socket.destroyed, true);
    const checkpoint = [...f.fs.files].find(([name]) => name.endsWith(".json"));
    assert.equal(JSON.parse(checkpoint[1]).verifiedBytes, 0);
});
