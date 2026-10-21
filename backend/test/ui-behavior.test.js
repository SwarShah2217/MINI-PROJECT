const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const tick = () => new Promise(setImmediate);

// A small DOM fixture exercises UI actions without a browser/server, permissions
// prompts or network requests. Visual browser validation remains a live check.
test("theme persists, notifications are opt-in, and recovery requires confirmation", async () => {
    const elements = new Map();
    const element = () => ({ textContent: "", disabled: false, children: [], dataset: {},
        setAttribute(name, value) { this[name] = value; },
        append(...children) { this.children.push(...children); },
        replaceChildren() { this.children = []; }
    });
    const document = { documentElement: element(),
        getElementById(id) { if (!elements.has(id)) elements.set(id, element()); return elements.get(id); },
        createElement: element };
    const storage = new Map();
    const requests = [];
    const notifications = [];
    let confirm = false;
    let permissionRequests = 0;
    class Notification {
        static permission = "default";
        static async requestPermission() { permissionRequests++; this.permission = "granted"; return "granted"; }
        constructor(title, options) { notifications.push(options.body); }
    }
    const source = { transferId: "fixture-id", fileName: "<source>.bin", fileSize: 5 };
    let status = { queueLength: 0, status: "idle", lastTransfer: null };
    const timers = [];
    const context = {
        document, Notification, window: { Notification, confirm: () => confirm,
            matchMedia: () => ({ matches: false }) },
        localStorage: { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value) },
        setTimeout: callback => timers.push(callback),
        fetch: async (url, options) => {
            requests.push({ url, options });
            return { ok: true, json: async () => url.endsWith("out-status") ? status
                : url.endsWith("recovery") ? { sources: [source] } : { success: true } };
        }
    };
    vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, "../../frontend/phase45.js"), "utf8"), context);
    await tick();
    assert.equal(permissionRequests, 0);
    assert.equal(notifications.length, 0);
    document.getElementById("themeToggle").onclick();
    assert.equal(document.documentElement.dataset.theme, "dark");
    assert.equal(storage.get("synclan-theme"), "dark");
    assert.equal(document.getElementById("themeToggle")["aria-pressed"], "true");
    await document.getElementById("enableNotifications").onclick();
    assert.equal(permissionRequests, 1);
    status = { queueLength: 0, status: "idle", lastTransfer: {
        transferId: "fixture", status: "completed", fileName: "fixture.bin", at: 42 } };
    await timers.shift()();
    await timers.shift()();
    assert.equal(notifications.length, 1);
    await document.getElementById("refreshRecovery").onclick();
    const row = document.getElementById("recoverySources").children[0];
    assert.match(row.children[0].textContent, /<source>.bin/);
    await row.children[1].onclick();
    assert.equal(requests.filter(r => r.options?.method === "POST").length, 0);
    confirm = true;
    await row.children[1].onclick();
    assert.equal(requests.filter(r => r.options?.method === "POST").length, 1);
    assert.match(document.getElementById("recoveryStatus").textContent, /Accept/);
});

test("transfer controls follow idle, pending, active, paused, verifying and reconnecting states", async () => {
    const elements = new Map();
    const get = id => {
        if (!elements.has(id)) {
            const classes = new Set(["hidden"]);
            elements.set(id, { textContent: "", style: {}, files: [], value: "", disabled: true,
                classList: { add: name => classes.add(name), remove: name => classes.delete(name),
                    contains: name => classes.has(name) },
                addEventListener() {}
            });
        }
        return elements.get(id);
    };
    let connection = { status: "disconnected", connected: false };
    let outgoing = { isPending: false, status: "idle" };
    const errors = [];
    const context = {
        document: { getElementById: get }, window: {}, setInterval() {},
        console: { error: (...args) => errors.push(args) },
        fetch: async (url, options) => {
            assert.equal(options?.method || "GET", "GET", "state checks must never issue transfer actions");
            const result = url === "/api/connection/status" ? connection
                : url === "/api/transfer/out-status" ? outgoing
                : url === "/api/devices" ? [] : { pending: false, ready: false };
            return { ok: true, json: async () => result };
        }
    };
    vm.createContext(context);
    vm.runInContext(fs.readFileSync(path.resolve(__dirname, "../../frontend/script.js"), "utf8"), context);
    await tick();
    assert.equal(get("fileInput").disabled, true);
    assert.equal(get("transferControls").classList.contains("hidden"), true);
    connection = { status: "connected", connected: true, peerIp: "fixture-only" };
    const states = [
        ["pending", true, true, true],
        ["transferring", false, true, false],
        ["paused", true, false, false],
        ["verifying", true, true, true]
    ];
    for (const [status, pauseHidden, resumeHidden, cancelHidden] of states) {
        outgoing = { isPending: true, status, fileName: "fixture.bin", sentBytes: 1048576, totalBytes: 2097152 };
        await context.loadConnectionStatus();
        assert.equal(get("transferControls").classList.contains("hidden"), false, status);
        assert.equal(get("pauseButton").classList.contains("hidden"), pauseHidden, status);
        assert.equal(get("resumeButton").classList.contains("hidden"), resumeHidden, status);
        assert.equal(get("cancelButton").classList.contains("hidden"), cancelHidden, status);
        assert.equal(get("progressBar").style.width, "50%");
    }
    for (const status of ["connecting", "pending", "disconnected"]) {
        connection = { status, connected: false };
        await context.loadConnectionStatus();
        assert.equal(get("fileInput").disabled, true, status);
        assert.equal(get("sourceFolderPath").disabled, true, status);
        assert.equal(get("transferControls").classList.contains("hidden"), true, status);
    }
    assert.deepEqual(errors, []);
});

test("speed/ETA and notification fallback render safely without starting any transfer", async () => {
    const elements = new Map();
    const get = id => {
        if (!elements.has(id)) elements.set(id, { textContent: "", setAttribute(name, value) { this[name] = value; } });
        return elements.get(id);
    };
    const timers = [];
    let status = { status: "transferring", queueLength: 2, sentBytes: 1048576,
        totalBytes: 4194304, bytesPerSecond: 1048576, etaSeconds: 3 };
    let permissionRequests = 0;
    class Notification {
        static permission = "default";
        static async requestPermission() { permissionRequests++; return "denied"; }
        constructor() { throw Error("Unexpected desktop notification before opt-in"); }
    }
    const context = {
        document: { getElementById: get, documentElement: { dataset: {} } },
        window: { Notification, matchMedia: () => ({ matches: false }) }, Notification,
        localStorage: { getItem: () => "dark", setItem() {} },
        setTimeout: callback => timers.push(callback),
        fetch: async (url, options) => {
            assert.equal(options?.method || "GET", "GET");
            return { ok: true, json: async () => status };
        }
    };
    vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, "../../frontend/phase45.js"), "utf8"), context);
    await tick();
    assert.equal(context.document.documentElement.dataset.theme, "dark");
    assert.match(get("transferMetrics").textContent, /1.00 MiB\/s.*ETA 3s/);
    assert.equal(get("outgoingProgress")["aria-valuenow"], "25");
    assert.match(get("transferQueue").textContent, /2 file/);
    assert.equal(permissionRequests, 0);
    status.status = "paused";
    await timers.shift()();
    assert.equal(get("transferMetrics").textContent, "Paused");
    status.status = "verifying";
    await timers.shift()();
    assert.match(get("transferMetrics").textContent, /Verifying.*SHA-256/);
    await get("enableNotifications").onclick();
    assert.equal(permissionRequests, 1);
    assert.match(get("notificationStatus").textContent, /disabled; status remains visible/);
});
