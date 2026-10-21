const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { load, Socket, memoryFs } = require("./helpers");
const HashService = require("../src/integrity/hashService");
const id = "22222222-2222-4222-8222-222222222222";
const tick = () => new Promise(setImmediate);

async function fixture(resume = false) {
    const fs = memoryFs();
    const socket = new Socket();
    const Manager = load("src/transfer/transferManager.js", {
        fs,
        net: { createConnection: (options, callback) => { setImmediate(callback); return socket; } },
        "../integrity/hashService": {
            hashFile: () => Promise.resolve("a".repeat(64)), hashBuffer: HashService.hashBuffer
        }
    });
    const manager = new Manager({ status: "connected", socket: new Socket() });
    const source = path.resolve(__dirname, "../temp", `${id}-fixture.bin`);
    fs.writeFileSync(source, Buffer.alloc(65536 + 17, 5));
    const transfer = { transferId: id, fileName: "fixture.bin", filePath: source,
        fileSize: 65536 + 17, status: "pending", resumeMode: resume };
    manager.activeTransfer = transfer;
    manager.sessionKeyManager.storeSessionKey(id, Buffer.alloc(32, 1));
    await manager.connectForFileTransfer("fake-peer");
    manager.sendFile(socket, resume);
    await tick();
    await tick();
    return { manager, socket, transfer, fs, source };
}

function response(socket, message) {
    socket.emit("data", Buffer.from(JSON.stringify(message) + "\n"));
}

test("sender waits for verified resume position before sending chunks", async () => {
    const f = await fixture(true);
    assert.equal(f.socket.writes.filter(Buffer.isBuffer).length, 0);
    f.manager.pauseTransfer();
    f.manager.resumeTransfer();
    await tick();
    assert.equal(f.socket.writes.filter(Buffer.isBuffer).length, 0);
    response(f.socket, { type: "RESUME_READY", transferId: id, verifiedBytes: 65536, nextChunk: 1 });
    await tick();
    assert.equal(f.socket.writes.filter(Buffer.isBuffer).length, 1);
    assert.equal(f.manager.offset, 65536 + 17);
    response(f.socket, { type: "CHUNK_ACK", chunkNumber: 1 });
    assert.equal(f.transfer.status, "verifying");
    response(f.socket, { type: "FILE_TRANSFER_COMPLETE" });
    await tick();
    assert.equal(f.manager.activeTransfer, null);
    assert.equal(f.manager.lastTransfer.status, "completed");
    assert.equal(f.fs.existsSync(f.source), true);
    assert.equal(f.fs.handles.size, 0);
});

test("sender paces chunks with ACK and retransmits NACK before advancing", async () => {
    const f = await fixture();
    await tick();
    assert.equal(f.socket.writes.filter(Buffer.isBuffer).length, 1);
    response(f.socket, { type: "CHUNK_NACK", chunkNumber: 0 });
    await tick(); await tick();
    assert.equal(f.socket.writes.filter(Buffer.isBuffer).length, 2);
    assert.equal(f.manager.offset, 65536);
    response(f.socket, { type: "CHUNK_ACK", chunkNumber: 0 });
    await tick();
    assert.equal(f.manager.offset, f.transfer.fileSize);
    response(f.socket, { type: "CHUNK_ACK", chunkNumber: 1 });
    response(f.socket, { type: "FILE_TRANSFER_COMPLETE" });
    await tick();
    assert.equal(f.manager.lastTransfer.status, "completed");
});

test("disconnect clears active state and retains source for explicit recovery", async () => {
    const f = await fixture(true);
    f.socket.destroy();
    await tick();
    assert.equal(f.manager.activeTransfer, null);
    assert.equal(f.manager.lastTransfer.status, "interrupted");
    assert.equal(f.fs.existsSync(f.source), true);
    assert.equal(f.fs.handles.size, 0);
    assert.equal(f.manager.queueInterruptedTransfer(id, "fixture.bin", f.transfer.fileSize), true);
    assert.equal(f.manager.activeTransfer.resumeMode, true);
    assert.equal(f.manager.queueInterruptedTransfer(id, "fixture.bin", f.transfer.fileSize), false);
});

test("cancel preserves source and a late old-socket response cannot complete the next file", async () => {
    const f = await fixture(true);
    assert.equal(f.manager.cancelTransfer(), true);
    const next = { transferId: "next", status: "pending" };
    f.manager.activeTransfer = next;
    response(f.socket, { type: "FILE_TRANSFER_COMPLETE" });
    await tick();
    assert.equal(f.manager.activeTransfer, next);
    assert.equal(f.manager.lastTransfer.status, "cancelled");
    assert.equal(f.fs.existsSync(f.source), true);
    assert.equal(f.fs.handles.size, 0);
});

test("unexpected ACK or premature completion aborts and preserves source", async () => {
    for (const message of [null, { type: "CHUNK_ACK", chunkNumber: 7 }, { type: "FILE_TRANSFER_COMPLETE" }]) {
        const f = await fixture(true);
        response(f.socket, message);
        await tick();
        assert.equal(f.socket.destroyed, true);
        assert.equal(f.manager.lastTransfer.status, "interrupted");
        assert.equal(f.fs.existsSync(f.source), true);
    }
});

test("pause/resume while a read is pending never starts duplicate reads", async () => {
    const f = await fixture();
    assert.equal(f.manager.pauseTransfer(), true);
    assert.equal(f.manager.resumeTransfer(), true);
    await tick();
    assert.equal(f.socket.writes.filter(Buffer.isBuffer).length, 1);
    response(f.socket, { type: "CHUNK_ACK", chunkNumber: 0 });
    await tick();
    assert.equal(f.socket.writes.filter(Buffer.isBuffer).length, 2);
    f.socket.destroy();
});
