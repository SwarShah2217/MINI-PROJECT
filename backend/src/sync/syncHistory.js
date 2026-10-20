
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

class SyncHistory {
    constructor() {
        this.file = path.join(
            __dirname,
            "../../data/sync-history.json"
        );

        fs.mkdirSync(path.dirname(this.file), {
            recursive: true
        });

        try {
            this.entries = JSON.parse(
                fs.readFileSync(this.file, "utf8")
            );

            if (!Array.isArray(this.entries)) {
                throw Error("Invalid history");
            }
        } catch (e) {
            if (e.code === "ENOENT") {
                this.entries = [];
            } else {
                throw e;
            }
        }
    }

    save() {
        const tmp = this.file + ".tmp";

        fs.writeFileSync(
            tmp,
            JSON.stringify(
                this.entries.slice(-500),
                null,
                2
            )
        );

        fs.renameSync(tmp, this.file);
    }

    add(data) {
        const entry = {
            id: crypto.randomUUID(),
            at: new Date().toISOString(),
            ...data
        };

        this.entries.push(entry);
        this.entries = this.entries.slice(-500);

        this.save();

        return entry;
    }

    update(id, patch) {
        const item = this.entries.find(
            e => e.id === id
        );

        if (!item) return null;

        Object.assign(item, patch, {
            updatedAt: new Date().toISOString()
        });

        this.save();

        return item;
    }

    list() {
        return this.entries.slice().reverse();
    }
}

module.exports = SyncHistory;
