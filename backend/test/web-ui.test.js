const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { load } = require("./helpers");

function webFixture(fs = {}) {
    const calls = [];
    const manager = {
        queueInterruptedTransfer: (...args) => { calls.push(args); return true; },
        getStatus: () => ({ isPending: false, lastTransfer: { status: "completed" } })
    };
    const Web = load("src/web/webServer.js", {
        fs, http: { createServer: () => ({}) },
        "../sync/syncHistory": class { constructor() { this.entries = []; } }
    });
    const web = new Web({ pendingFileRequest: null }, {}, {}, manager, {});
    function request(url, method = "GET", body, headers = {}) {
        const req = new EventEmitter();
        Object.assign(req, { url, method, headers: { host: "localhost:3000", ...headers } });
        const res = {
            writeHead(status, responseHeaders) { this.status = status; this.headers = responseHeaders; },
            end(value) { this.body = JSON.parse(value); }
        };
        web.handleRequest(req, res);
        if (body !== undefined) req.emit("data", Buffer.from(body));
        req.emit("end");
        return res;
    }
    return { calls, request };
}

test("recovery API requires explicit JSON POST and rejects foreign origins and invalid JSON", () => {
    const f = webFixture();
    assert.equal(f.request("/api/transfer/recover", "POST", "{}").status, 403);
    assert.equal(f.request("/api/transfer/recover", "POST", "{}", {
        "content-type": "application/json", origin: "http://untrusted.invalid"
    }).status, 403);
    assert.equal(f.request("/api/transfer/recover", "POST", "{bad", {
        "content-type": "application/json"
    }).status, 400);
    assert.equal(f.calls.length, 0);
    const source = { transferId: "fixture-id", fileName: "fixture.bin", fileSize: 99 };
    const response = f.request("/api/transfer/recover", "POST", JSON.stringify(source), {
        "content-type": "application/json", origin: "http://localhost:3000"
    });
    assert.equal(response.status, 200);
    assert.deepEqual(f.calls, [["fixture-id", "fixture.bin", 99]]);
});

test("oversized recovery payload is rejected without queueing anything", () => {
    const f = webFixture();
    const response = f.request("/api/transfer/recover", "POST", "a".repeat(4097), {
        "content-type": "application/json"
    });
    assert.equal(response.status, 413);
    assert.equal(f.calls.length, 0);
});

test("read-only recovery discovery lists regular retained sources and skips symlinks", () => {
    const id = "11111111-1111-4111-8111-111111111111";
    const f = webFixture({ existsSync: () => true,
        readdirSync: () => [`${id}-source.bin`, `${id}-link.bin`, "other-file"],
        lstatSync: filename => ({ isFile: () => true, isSymbolicLink: () => filename.endsWith("link.bin"), size: 17 })
    });
    const response = f.request("/api/transfer/recovery");
    assert.equal(response.status, 200);
    assert.equal(response.body.sources.length, 1);
    assert.equal(response.body.sources[0].fileName, "source.bin");
    assert.equal(f.calls.length, 0);
});

test("status endpoint exposes terminal result even when no transfer is active", () => {
    const f = webFixture();
    const response = f.request("/api/transfer/out-status");
    assert.equal(response.status, 200);
    assert.equal(response.body.lastTransfer.status, "completed");
});

test("speed/ETA count acknowledged bytes and exclude the verified resume prefix", () => {
    const Manager = load("src/transfer/transferManager.js");
    const manager = new Manager({});
    manager.activeTransfer = { transferId: "fixture", status: "transferring", fileSize: 262144 };
    manager.offset = 196608; // Sent but not all acknowledged yet.
    manager.acknowledgedBytes = 131072;
    manager.progressStartBytes = 65536;
    manager.progressStartedAt = 1000;
    const data = manager.getStatus(3000);
    assert.equal(data.sentBytes, 131072);
    assert.equal(data.bytesPerSecond, 32768);
    assert.equal(data.etaSeconds, 4);
    manager.activeTransfer.status = "paused";
    assert.equal(manager.getStatus(4000).bytesPerSecond, 0);
    assert.equal(manager.getStatus(4000).etaSeconds, null);
});
