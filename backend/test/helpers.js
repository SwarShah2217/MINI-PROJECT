const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { createRequire } = require("node:module");
const { EventEmitter } = require("node:events");

// Execute production modules with explicit dependencies. Tests never listen on
// ports or access the real downloads/temp/checkpoint directories.
function load(relativePath, mocks = {}) {
    const filename = path.resolve(__dirname, "..", relativePath);
    const nativeRequire = createRequire(filename);
    const module = { exports: {} };
    const context = {
        module, exports: module.exports, Buffer, setImmediate,
        __dirname: path.dirname(filename),
        console: { log() {}, error() {}, warn() {} },
        require: name => Object.hasOwn(mocks, name) ? mocks[name] : nativeRequire(name)
    };
    vm.runInNewContext(fs.readFileSync(filename, "utf8"), context, { filename });
    return module.exports;
}

class Socket extends EventEmitter {
    constructor() {
        super();
        this.destroyed = false;
        this.writes = [];
    }
    write(data) { this.writes.push(data); return true; }
    destroy() {
        if (this.destroyed) return;
        this.destroyed = true;
        this.emit("close");
    }
    end() { this.destroy(); }
    messages() {
        return this.writes.filter(x => typeof x === "string").map(x => JSON.parse(x));
    }
}

function memoryFs() {
    const files = new Map();
    const handles = new Map();
    let nextFd = 1;
    const key = name => path.resolve(name);
    const api = {
        files, handles,
        existsSync: name => files.has(key(name)),
        mkdirSync() {},
        readFileSync(name) {
            if (!files.has(key(name))) throw Error("ENOENT");
            return files.get(key(name)).toString();
        },
        writeFileSync(name, value) { files.set(key(name), Buffer.from(value)); },
        renameSync(from, to) {
            files.set(key(to), files.get(key(from)));
            files.delete(key(from));
        },
        statSync(name) {
            const data = files.get(key(name));
            if (!data) throw Error("ENOENT");
            return { isFile: () => true, size: data.length };
        },
        openSync(name, mode) {
            name = key(name);
            if (mode === "wx" && files.has(name)) throw Error("EEXIST");
            if ((mode === "r+" || mode === "r") && !files.has(name)) throw Error("ENOENT");
            if (mode === "w" || mode === "wx") files.set(name, Buffer.alloc(0));
            const fd = nextFd++;
            handles.set(fd, name);
            return fd;
        },
        closeSync(fd) {
            if (!handles.delete(fd)) throw Error("EBADF");
        },
        fsyncSync() {},
        readSync(fd, buffer, offset, length, position) {
            const data = files.get(handles.get(fd));
            if (!data) throw Error("EBADF");
            return data.copy(buffer, offset, position, position + length);
        },
        writeSync(fd, data, offset, length, position) {
            const name = handles.get(fd);
            if (!name) throw Error("EBADF");
            const previous = files.get(name);
            const updated = Buffer.alloc(Math.max(previous.length, position + length));
            previous.copy(updated);
            data.copy(updated, position, offset, offset + length);
            files.set(name, updated);
            return length;
        },
        unlinkSync(name) { files.delete(key(name)); },
        unlink(name, callback) { api.unlinkSync(name); setImmediate(() => callback(null)); }
    };
    api.open = (name, mode, callback) => setImmediate(() => {
        try { callback(null, api.openSync(name, mode)); } catch (error) { callback(error); }
    });
    api.close = (fd, callback) => setImmediate(() => {
        try { api.closeSync(fd); callback(null); } catch (error) { callback(error); }
    });
    api.read = (fd, buffer, offset, length, position, callback) => setImmediate(() => {
        try { callback(null, api.readSync(fd, buffer, offset, length, position)); } catch (error) { callback(error); }
    });
    return api;
}

module.exports = { load, Socket, memoryFs };
