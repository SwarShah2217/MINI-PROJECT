const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const root = path.resolve(__dirname, "..");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const tick = () => new Promise(setImmediate);

// A DOM fixture based on the actual HTML. No browser, backend, transfer data or
// network is used. This validates behavior/markup contracts, not visual layout.
function fixture(options = {}) {
    const elements = [];
    const handlers = {};
    const requests = [];
    const timers = [];
    const intervals = [];
    const storage = new Map(Object.entries(options.storage || {}));
    let document;
    class Element {
        constructor(tag, attributes = {}) {
            this.tagName = tag; this.attributes = attributes; this.id = attributes.id || "";
            this.className = attributes.class || ""; this.dataset = {}; this.children = [];
            this.parentElement = null; this.events = {}; this.style = {}; this.value = "";
            this.files = []; this.disabled = Object.hasOwn(attributes, "disabled");
            this.hidden = Object.hasOwn(attributes, "hidden"); this.checked = false;
            this.textContent = ""; this.scrollTop = 0; this.scrollHeight = 100; this.clientHeight = 100;
            for (const [key, value] of Object.entries(attributes)) if (key.startsWith("data-")) this.dataset[key.slice(5)] = value;
            this.classList = {
                contains: name => this.className.split(/\s+/).includes(name),
                add: name => { if (!this.classList.contains(name)) this.className += " " + name; },
                remove: name => { this.className = this.className.split(/\s+/).filter(x => x !== name).join(" "); }
            };
            elements.push(this);
        }
        setAttribute(name, value) { this.attributes[name] = value; }
        getAttribute(name) { return this.attributes[name]; }
        removeAttribute(name) { delete this.attributes[name]; }
        addEventListener(name, callback) { (this.events[name] ||= []).push(callback); }
        async fire(name, extra = {}) {
            const event = { target: this, preventDefault() {}, ...extra };
            for (const callback of this.events[name] || []) await callback(event);
            if (name === "click" && this.onclick) await this.onclick(event);
        }
        append(...nodes) { for (const node of nodes) { this.children.push(node); if (node instanceof Element) node.parentElement = this; } }
        appendChild(node) { this.append(node); }
        replaceChildren() { this.children = []; }
        set innerHTML(value) { this._html = value; this.children = []; }
        get innerHTML() { return this._html || ""; }
        closest(tag) { for (let node = this; node; node = node.parentElement) if (node.tagName === tag) return node; return null; }
        focus() { document.activeElement = this; }
        click() { this.clicked = true; }
    }
    // Parse element nesting and attributes; text is populated by feature scripts.
    const stack = [];
    for (const token of html.matchAll(/<!--[^]*?-->|<\/?([a-z][\w-]*)([^>]*?)>/gi)) {
        if (!token[1]) continue;
        const tag = token[1].toLowerCase();
        if (token[0].startsWith("</")) {
            const index = stack.map(x => x.tagName).lastIndexOf(tag);
            if (index >= 0) stack.length = index;
            continue;
        }
        const attributes = {};
        for (const attr of token[2].matchAll(/([\w:-]+)(?:="([^"]*)")?/g)) attributes[attr[1]] = attr[2] ?? "";
        const element = new Element(tag, attributes);
        if (stack.length) stack.at(-1).append(element);
        if (!/\/$/.test(token[2]) && !["meta", "link", "input", "img", "use", "path", "rect", "circle"].includes(tag)) stack.push(element);
    }
    const matches = (element, selector) => selector.startsWith(".")
        ? element.classList.contains(selector.slice(1).split(":")[0]) && (!selector.endsWith(":checked") || element.checked)
        : selector === "[data-view]" ? !!element.dataset.view : false;
    document = {
        getElementById: id => elements.find(element => element.id === id) || null,
        querySelectorAll: selector => elements.filter(element => matches(element, selector)),
        createElement: tag => new Element(tag), createTextNode: text => text,
        documentElement: elements.find(x => x.tagName === "html")
    };
    const get = document.getElementById;
    const state = {
        connection: { status: "disconnected", connected: false, peerIp: null }, devices: [],
        outgoing: { isPending: false, status: "idle", sentBytes: 0, totalBytes: 0, queueLength: 0, incoming: null },
        messages: [], activity: [], sources: [], history: [], preview: { ready: false }, confirm: false,
        pendingConnection: { pending: false }, pendingFile: { pending: false },
        ...options.state
    };
    const context = { document, console: { error: (...args) => errors.push(args), warn: (...args) => errors.push(args) },
        location: { host: "127.0.0.1:3000", hash: options.hash || "" },
        history: { pushState(a, b, hash) { context.location.hash = hash; } },
        addEventListener: (name, callback) => { handlers[name] = callback; },
        localStorage: { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value) },
        matchMedia: () => ({ matches: false }), confirm: () => state.confirm,
        setInterval: callback => intervals.push(callback), setTimeout: callback => timers.push(callback),
        fetch: async (url, init = {}) => {
            requests.push({ url, ...init });
            if (options.handleRequest) {
                const response = await options.handleRequest(url, init, state);
                if (response) return response;
            }
            const bodies = {
                "/api/connection/status": state.connection, "/api/devices": state.devices,
                "/api/connection/pending": state.pendingConnection, "/api/transfer/pending": state.pendingFile,
                "/api/transfer/out-status": state.outgoing, "/api/chat/messages": { messages: state.messages },
                "/api/activity": { activity: state.activity }, "/api/sync/history": { entries: state.history },
                "/api/sync/status": { ready: false }, "/api/sync/preview-status": state.preview,
                "/api/transfer/recovery": { sources: state.sources }, "/api/sync/preview": { previewId: "fixture-preview" },
                "/api/pairing/create": { pin: "123456", qr: "fixture-image", ips: ["192.168.1.2"] },
                "/api/pairing/connect": { message: "Pairing requested" }
            };
            if (init.method === "POST") return { ok: true, json: async () => bodies[url] || { success: true, queued: 1, requested: 1 } };
            assert.ok(Object.hasOwn(bodies, url), "unexpected API: " + url);
            return { ok: true, json: async () => bodies[url] };
        }
    };
    const errors = [];
    context.window = context;
    vm.createContext(context);
    for (const file of ["script.js", "phase42.js", "phase43.js", "phase44a.js", "phase45.js"]) {
        vm.runInContext(fs.readFileSync(path.join(root, file), "utf8"), context, { filename: file });
    }
    return { get, elements, state, requests, storage, context, handlers, timers, intervals, errors };
}

test("HTML contains unique IDs, seven labelled views, and all existing control bindings", () => {
    const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
    assert.equal(new Set(ids).size, ids.length, "duplicate control ID");
    assert.equal(ids.filter(id => id.startsWith("view-")).length, 7);
    for (const file of ["script.js", "phase42.js", "phase43.js", "phase44a.js", "phase45.js"]) {
        const source = fs.readFileSync(path.join(root, file), "utf8");
        for (const match of source.matchAll(/(?:getElementById|\$)\("([^"]+)"\)/g)) assert.ok(ids.includes(match[1]), file + ": " + match[1]);
        assert.ok(html.includes('src="/' + file + '"'));
    }
    assert.ok(html.includes('aria-label="Main navigation"'));
    assert.ok(html.includes('role="log"'));
    assert.ok(!/https?:\/\//.test(html.replace('http://www.w3.org/2000/svg', '')), "no external UI assets");
});

test("all seven views navigate, restore and handle browser history without API writes", async () => {
    const f = fixture({ storage: { "synclan-view": "chat" } });
    await tick();
    assert.equal(f.get("view-chat").hidden, false);
    for (const view of ["dashboard", "devices", "transfers", "chat", "sync", "pairing", "settings"]) {
        const link = f.elements.find(x => x.dataset.view === view && x.closest("nav"));
        await link.fire("click");
        assert.equal(f.elements.filter(x => x.classList.contains("app-view") && !x.hidden).length, 1);
        assert.equal(f.get("view-" + view).hidden, false);
        assert.equal(link.getAttribute("aria-current"), "page");
        assert.equal(f.context.document.activeElement, f.get("viewTitle"));
        assert.equal(f.storage.get("synclan-view"), view);
    }
    f.context.location.hash = "#transfers";
    f.handlers.hashchange();
    assert.equal(f.get("view-transfers").hidden, false);
    f.context.location.hash = "#unknown";
    f.handlers.hashchange();
    assert.equal(f.get("view-dashboard").hidden, false);
    assert.equal(f.requests.filter(x => x.method === "POST").length, 0);
    assert.deepEqual(f.errors, []);
});

test("incoming request controls remain outside views and backend failure disables stale actions", async () => {
    const f = fixture({ hash: "#settings", state: {
        connection: { status: "connected", connected: true, peerIp: "192.168.1.9" }
    } });
    await tick();
    assert.equal(f.get("connectionRequest").parentElement.className, "request-stack");
    assert.equal(f.get("fileRequestBox").parentElement.className, "request-stack");
    assert.equal(f.get("sendFileButton").disabled, false);
    f.context.fetch = async () => { throw Error("simulated backend outage"); };
    await f.context.loadConnectionStatus();
    assert.equal(f.get("status").textContent, "Local backend unavailable");
    for (const id of ["sendFileButton", "fileInput", "sourceFolderPath", "destinationFolderPath", "phase42Send", "phase43PreviewButton"]) {
        assert.equal(f.get(id).disabled, true, id);
    }
    assert.equal(f.get("view-settings").hidden, false);
});

test("nearby devices use real API state, escape names and preserve connect action", async () => {
    const f = fixture({ state: { devices: [{ deviceName: "<LAN peer>", ip: "192.168.1.9" }] } });
    await tick();
    await f.context.loadDevices();
    const device = f.get("deviceList").children[0];
    assert.equal(device.children[1].children[0].textContent, "<LAN peer>");
    await f.context.loadDevices();
    assert.equal(f.get("deviceList").children[0], device, "unchanged discovery must preserve focused controls");
    assert.equal(f.get("deviceCount").textContent, "1 device");
    assert.equal(f.get("phase42Send").disabled, true);
    await device.children[2].fire("click");
    const request = f.requests.find(entry => entry.url === "/api/connection/connect");
    assert.equal(request.method, "POST");
    assert.equal(JSON.parse(request.body).ip, "192.168.1.9");
    f.state.connection = { status: "connected", connected: true, peerIp: "192.168.1.9" };
    await f.context.loadConnectionStatus();
    assert.equal(f.get("dashboardPeer").textContent, "<LAN peer>");
    assert.equal(f.get("chatPeer").textContent, "<LAN peer>");
    assert.equal(f.get("phase42Send").disabled, false);
    assert.deepEqual(f.errors, []);
});

test("chat renders distinct safe bubbles and sends through the existing endpoint", async () => {
    const f = fixture({ state: { connection: { status: "connected", connected: true, peerIp: "192.168.1.9" }, messages: [
        { direction: "incoming", text: "<message>", timestamp: "2026-10-22T00:00:00Z" },
        { direction: "outgoing", text: "reply", timestamp: "2026-10-22T00:01:00Z" }
    ] } });
    await tick();
    const messages = f.get("phase42Messages").children;
    assert.equal(messages[0].className, "message incoming");
    assert.equal(messages[0].children[0].textContent, "<message>");
    assert.equal(messages[1].className, "message outgoing");
    f.get("phase42Input").value = " hello ";
    await f.get("phase42Send").fire("click");
    const sent = f.requests.find(x => x.url === "/api/chat/send");
    assert.equal(JSON.parse(sent.body).text, "hello");
    assert.equal(f.get("phase42Input").value, "");
    assert.equal(f.get("view-dashboard").hidden, false, "chat polling must not change navigation");
    assert.deepEqual(f.errors, []);
});

test("transfer progress and explicit recovery remain functional in their dedicated view", async () => {
    const f = fixture({ hash: "#transfers", state: {
        connection: { status: "connected", connected: true, peerIp: "192.168.1.9" },
        outgoing: { isPending: true, status: "transferring", fileName: "fixture.bin", sentBytes: 1048576,
            totalBytes: 2097152, bytesPerSecond: 1048576, etaSeconds: 1, queueLength: 2 },
        sources: [{ transferId: "test-only-id", fileName: "fixture.bin", fileSize: 2097152 }]
    } });
    await tick();
    assert.equal(f.get("outgoingProgress").getAttribute("aria-valuenow"), "50");
    assert.equal(f.get("progressBar").style.width, "50%");
    assert.match(f.get("transferMetrics").textContent, /ETA 1s/);
    assert.equal(f.get("dashboardQueue").textContent, "2 files waiting");
    await f.get("pauseButton").fire("click");
    assert.equal(f.requests.at(-1).url, "/api/transfer/pause");
    await f.get("refreshRecovery").fire("click");
    const recover = f.get("recoverySources").children[0].children[1];
    await recover.fire("click");
    assert.equal(f.requests.filter(x => x.url === "/api/transfer/recover").length, 0);
    f.state.confirm = true;
    await recover.fire("click");
    assert.equal(f.requests.at(-1).url, "/api/transfer/recover");
    assert.equal(JSON.parse(f.requests.at(-1).body).transferId, "test-only-id");
    assert.deepEqual(f.errors, []);
});

test("folder preview, selection and confirmation preserve existing API contracts", async () => {
    const f = fixture({ hash: "#sync", state: { connection: { status: "connected", connected: true, peerIp: "192.168.1.9" } } });
    await tick();
    f.get("sourceFolderPath").value = "C:\\fixture-source";
    f.get("destinationFolderPath").value = "C:\\fixture-destination";
    await f.get("phase43PreviewButton").fire("click");
    const preview = f.requests.find(x => x.url === "/api/sync/preview");
    assert.equal(JSON.parse(preview.body).sourcePath, "C:\\fixture-source");
    f.state.preview = { previewId: "fixture-preview", ready: true, comparison: {
        newFiles: [{ relativePath: "new.txt", size: 2 }], modifiedFiles: [],
        unchangedFiles: [{ relativePath: "same.txt", size: 2 }]
    } };
    for (const interval of f.intervals) await interval();
    await tick();
    assert.equal(f.get("phase43Panel").style.display, "block");
    const checkboxes = f.elements.filter(x => x.className === "phase43-check");
    assert.equal(checkboxes[0].checked, true);
    assert.equal(checkboxes[1].disabled, true);
    f.state.confirm = true;
    await f.get("phase43Selected").fire("click");
    const confirmed = f.requests.find(x => x.url === "/api/sync/confirm");
    assert.deepEqual(JSON.parse(confirmed.body).selectedPaths, ["new.txt"]);
    assert.deepEqual(f.errors, []);
});

test("pairing and settings actions use existing handlers without navigation side effects", async () => {
    const f = fixture({ hash: "#pairing" });
    await tick();
    await f.get("p44create").fire("click");
    assert.equal(f.get("p44pin").textContent, "123456");
    assert.equal(f.get("p44qr").style.display, "block");
    f.get("p44host").value = "192.168.1.8";
    f.get("p44code").value = "123456";
    await f.get("p44connect").fire("click");
    const paired = f.requests.find(x => x.url === "/api/pairing/connect");
    assert.deepEqual(JSON.parse(paired.body), { ip: "192.168.1.8", kind: "pin", value: "123456" });
    await f.get("themeToggle").fire("click");
    assert.equal(f.context.document.documentElement.dataset.theme, "dark");
    assert.equal(f.storage.get("synclan-theme"), "dark");
    assert.equal(f.get("enableNotifications").disabled, true, "unsupported notifications should be disabled");
    assert.deepEqual(f.errors, []);
});

test("connection requests lock synchronously, revalidate devices and show honest failed outcomes", async () => {
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    const f = fixture({ hash: "#devices", state: { devices: [
        { deviceName: "PC A", ip: "192.168.1.9" }, { deviceName: "PC B", ip: "192.168.1.10" },
        { deviceName: "duplicate", ip: "192.168.1.9" }, { deviceName: "invalid", ip: "999.1.1.1" }
    ] }, handleRequest: async (url, init, state) => {
        if (url === "/api/connection/connect" && init.method === "POST") {
            await gate;
            state.connection = { status: "connecting", connected: false, peerIp: "192.168.1.9" };
        }
    } });
    await tick();
    assert.equal(f.get("deviceList").children.length, 2);
    const first = f.get("deviceList").children[0].children[2];
    const second = f.get("deviceList").children[1].children[2];
    assert.equal(first.textContent, "Request Connection");
    const click = first.fire("click");
    await second.fire("click");
    await first.fire("click");
    await tick();
    assert.equal(f.requests.filter(x => x.url === "/api/connection/connect").length, 1);
    release();
    await click;
    assert.match(f.get("connectionNotice").textContent, /Waiting for the receiving PC/);
    assert.equal(f.get("deviceList").children[0].children[2].textContent, "Request sent");
    assert.equal(f.get("deviceList").children[1].children[2].disabled, true);
    f.state.connection = { status: "disconnected", connected: false, peerIp: null };
    await f.context.loadConnectionStatus();
    assert.match(f.get("connectionNotice").textContent, /may have rejected it or the connection failed/);
    assert.equal(f.get("deviceList").children[0].children[2].disabled, false);
    f.state.devices = [];
    await f.context.requestDeviceConnection("192.168.1.9");
    await f.context.requestDeviceConnection("invalid-host");
    assert.equal(f.requests.filter(x => x.url === "/api/connection/connect").length, 1);
    assert.equal(f.get("deviceList").children.length, 0, "stale devices removed");
    assert.deepEqual(f.errors, []);
});

test("connection and file requests stay visible on every view and connection accept/reject remain explicit", async () => {
    for (const action of ["accept", "reject"]) {
        const f = fixture({ state: {
            devices: [{ deviceName: "Peer", ip: "192.168.1.9" }],
            connection: { status: "pending", connected: false, peerIp: "192.168.1.9" },
            pendingConnection: { pending: true, ip: "192.168.1.9" },
            pendingFile: { pending: true, transferId: "fixture-a", fileName: "new.txt", fileSize: 7 }
        }, handleRequest: async (url, init, state) => {
            if (url === "/api/connection/" + action && init.method === "POST") {
                state.pendingConnection = { pending: false };
                state.connection = action === "accept" ? { status: "connected", connected: true, peerIp: "192.168.1.9" }
                    : { status: "disconnected", connected: false, peerIp: null };
            }
        } });
        await tick();
        await f.context.checkPendingConnection();
        for (const view of ["dashboard", "devices", "transfers", "chat", "sync", "pairing", "settings"]) {
            const nav = f.elements.find(x => x.dataset.view === view && x.closest("nav"));
            await nav.fire("click");
            for (const id of ["connectionRequest", "fileRequestBox"]) {
                for (let element = f.get(id); element; element = element.parentElement) {
                    assert.equal(element.hidden || element.classList.contains("hidden"), false, id + " on " + view);
                }
            }
        }
        assert.equal(f.requests.filter(x => x.method === "POST").length, 0);
        const button = f.get(action === "accept" ? "acceptButton" : "rejectButton");
        await Promise.all([button.fire("click"), button.fire("click")]);
        assert.equal(f.requests.filter(x => x.url === "/api/connection/" + action && x.method === "POST").length, 1);
        assert.equal(f.get("connectionRequest").classList.contains("hidden"), true);
        assert.match(f.get("connectionNotice").textContent, action === "accept" ? /Accepted incoming/ : /Rejected incoming/);
        assert.equal(f.get("sendFileButton").disabled, action !== "accept");
        assert.deepEqual(f.errors, []);
    }
});

test("changed approvals are not submitted and failed file decisions stay visible", async () => {
    const f = fixture({ state: {
        pendingConnection: { pending: true, ip: "192.168.1.9" },
        pendingFile: { pending: true, transferId: "fixture-a", fileName: "a.txt", fileSize: 1 }
    }, handleRequest: async (url, init) => {
        if (url === "/api/transfer/reject" && init.method === "POST") return {
            ok: false, json: async () => ({ success: false, error: "Simulated reject failure" })
        };
    } });
    await tick();
    f.state.pendingConnection = { pending: true, ip: "192.168.1.10" };
    await f.get("acceptButton").fire("click");
    assert.equal(f.requests.filter(x => x.url === "/api/connection/accept").length, 0);
    assert.equal(f.get("connectionRequest").classList.contains("hidden"), false);
    assert.match(f.get("requestMessage").textContent, /192.168.1.10/);
    f.state.pendingFile = { pending: true, transferId: "fixture-b", fileName: "b.txt", fileSize: 2 };
    await f.get("acceptFileButton").fire("click");
    assert.equal(f.requests.filter(x => x.url === "/api/transfer/accept").length, 0);
    assert.match(f.get("fileRequestMessage").textContent, /b.txt/);
    await f.get("rejectFileButton").fire("click");
    assert.equal(f.get("fileRequestBox").classList.contains("hidden"), false);
    assert.match(f.get("fileRequestError").textContent, /Simulated reject failure/);
    assert.equal(f.get("rejectFileButton").disabled, false);
    assert.deepEqual(f.errors, []);
});

test("file accept/reject cannot double-submit and preserve receiver approval", async () => {
    for (const action of ["accept", "reject"]) {
        const f = fixture({ state: {
            pendingFile: { pending: true, transferId: "new-fixture", fileName: "fresh.txt", fileSize: 3, resume: false }
        }, handleRequest: async (url, init, state) => {
            if (url === "/api/transfer/" + action && init.method === "POST") state.pendingFile = { pending: false };
        } });
        await tick();
        const button = f.get(action === "accept" ? "acceptFileButton" : "rejectFileButton");
        await Promise.all([button.fire("click"), button.fire("click")]);
        assert.equal(f.requests.filter(x => x.url === "/api/transfer/" + action && x.method === "POST").length, 1);
        assert.equal(f.get("fileRequestBox").classList.contains("hidden"), true);
        assert.deepEqual(f.errors, []);
    }
});

test("folder permissions require a fresh preview, a connected peer and explicit confirmation", async () => {
    const f = fixture({ state: { connection: { status: "connected", connected: true, peerIp: "192.168.1.9" } } });
    await tick();
    f.get("sourceFolderPath").value = "C:\\fresh-source";
    f.get("destinationFolderPath").value = "C:\\fresh-destination";
    f.state.confirm = true;
    await f.get("phase43Whole").fire("click");
    assert.equal(f.requests.filter(x => x.url === "/api/sync/confirm").length, 0);
    async function preview() {
        await f.get("phase43PreviewButton").fire("click");
        f.state.preview = { previewId: "fixture-preview", ready: true, comparison: {
            newFiles: [{ relativePath: "fresh.txt", size: 3 }], modifiedFiles: [], unchangedFiles: []
        } };
        for (const interval of f.intervals) await interval();
        await tick();
    }
    await preview();
    f.state.confirm = false;
    await f.get("phase43Whole").fire("click");
    assert.equal(f.requests.filter(x => x.url === "/api/sync/confirm").length, 0);
    f.state.confirm = true;
    f.get("destinationFolderPath").value = "C:\\changed";
    await f.get("phase43Whole").fire("click");
    assert.equal(f.requests.filter(x => x.url === "/api/sync/confirm").length, 0);
    await preview();
    f.state.connection = { status: "disconnected", connected: false, peerIp: null };
    await f.context.loadConnectionStatus();
    assert.equal(f.get("phase43Selected").disabled, true);
    await f.get("phase43Selected").fire("click");
    assert.equal(f.requests.filter(x => x.url === "/api/sync/confirm").length, 0);
    f.state.connection = { status: "connected", connected: true, peerIp: "192.168.1.9" };
    await f.context.loadConnectionStatus();
    await preview();
    await Promise.all([f.get("phase43Whole").fire("click"), f.get("phase43Whole").fire("click")]);
    assert.equal(f.requests.filter(x => x.url === "/api/sync/confirm").length, 1);
    assert.deepEqual(f.errors, []);
});

test("discovery errors and another tab's connection block invalid outgoing requests", async () => {
    const f = fixture({ state: { devices: [{ deviceName: "Peer", ip: "192.168.1.9" }] },
        handleRequest: async (url, init, state) => {
            if (url === "/api/connection/connect" && init.method === "POST") {
                state.connection = { status: "connecting", connected: false, peerIp: "192.168.1.20" };
            }
        }
    });
    await tick();
    await f.context.requestDeviceConnection("192.168.1.9");
    assert.match(f.get("connectionNotice").textContent, /Another connection or request is active/);
    assert.equal(f.get("deviceList").children[0].children[2].disabled, true);
    f.state.connection = { status: "disconnected", connected: false, peerIp: null };
    await f.context.loadConnectionStatus();
    const before = f.requests.filter(x => x.method === "POST").length;
    const fetch = f.context.fetch;
    f.context.fetch = async (url, init) => url === "/api/devices"
        ? { ok: false, json: async () => ({ error: "Unavailable" }) } : fetch(url, init);
    await f.context.loadDevices();
    assert.equal(f.get("deviceList").children[0].children[2].disabled, true);
    await f.context.requestDeviceConnection("192.168.1.9");
    assert.equal(f.requests.filter(x => x.method === "POST").length, before);
    assert.match(f.get("devicesFeedback").textContent, /discovery is unavailable/);
    assert.deepEqual(f.errors, []);
});

test("failed connection decisions retain the banner and expiry prevents stale file approval", async () => {
    const f = fixture({ state: {
        connection: { status: "pending", connected: false, peerIp: "192.168.1.9" },
        pendingConnection: { pending: true, ip: "192.168.1.9" },
        pendingFile: { pending: true, transferId: "fixture-expired", fileName: "new.txt", fileSize: 3 }
    }, handleRequest: async (url, init) => {
        if (url === "/api/connection/accept" && init.method === "POST") return {
            ok: false, json: async () => ({ error: "Simulated approval failure" })
        };
    } });
    await tick();
    await f.get("acceptButton").fire("click");
    assert.equal(f.get("connectionRequest").classList.contains("hidden"), false);
    assert.match(f.get("connectionRequestError").textContent, /Simulated approval failure/);
    assert.equal(f.get("acceptButton").disabled, false);
    f.state.pendingFile = { pending: false };
    await f.get("acceptFileButton").fire("click");
    assert.equal(f.requests.filter(x => x.url === "/api/transfer/accept").length, 0);
    assert.equal(f.get("fileRequestBox").classList.contains("hidden"), true);
    assert.match(f.get("connectionNotice").textContent, /expired or changed/);
    assert.deepEqual(f.errors, []);
});
