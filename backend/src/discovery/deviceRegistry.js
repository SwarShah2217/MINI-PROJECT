//remembers devices and ip
class DeviceRegistry {
    constructor() {
        this.devices = new Map();
    }

    addOrUpdateDevice(device) {
        const updatedDevice = {
            deviceName: device.deviceName,
            ip: device.ip,
            lastSeen: Date.now()
        };

        this.devices.set(device.ip, updatedDevice);
    }

    getDevices() {
        return Array.from(this.devices.values());
    }

    getDevice(ip) {
        return this.devices.get(ip);
    }

    removeStaleDevices(timeout = 15000) {
        const currentTime = Date.now();

        for (const [ip, device] of this.devices.entries()) {
            if (currentTime - device.lastSeen > timeout) {
                this.devices.delete(ip);

                console.log(`Device offline: ${device.deviceName}`);
            }
        }
    }
}

module.exports = DeviceRegistry;