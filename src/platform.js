"use strict";

const { PLATFORM_NAME, PLUGIN_NAME, DEFAULTS } = require("./settings");
const { DevialetClient } = require("./devialetClient");
const { DevialetAccessory } = require("./platformAccessory");

const STARTUP_RETRIES = 5;
const STARTUP_RETRY_DELAY = 4000;

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Dynamic platform. Television accessories must be published as external
// accessories (HomeKit allows only one TV per bridge), so they are not cached
// via configureAccessory; we (re)build and publish them on each launch.
class DevialetPlatform {
  constructor(log, config, api) {
    this.log = log;
    this.config = config || {};
    this.api = api;
    this.Service = api.hap.Service;
    this.Characteristic = api.hap.Characteristic;
    this.accessories = [];
    this.handlers = [];

    this.api.on("didFinishLaunching", () => {
      this.discoverDevices().catch((err) => {
        this.log.error(`Discovery failed: ${err.message}`);
      });
    });

    this.api.on("shutdown", () => {
      for (const handler of this.handlers) {
        handler.stop();
      }
    });
  }

  // Cached accessories are not used for external TV accessories, but Homebridge
  // still calls this for anything previously registered.
  configureAccessory(accessory) {
    this.accessories.push(accessory);
  }

  resolveDevices() {
    if (Array.isArray(this.config.devices) && this.config.devices.length > 0) {
      return this.config.devices;
    }
    if (this.config.ip) {
      return [this.config];
    }
    return [];
  }

  withDefaults(device) {
    return {
      name: device.name || "Phantom",
      ip: device.ip,
      port: device.port || 80,
      pollInterval: numberOr(device.pollInterval, DEFAULTS.pollInterval),
      maxVolume: clampInt(device.maxVolume, 1, 100, DEFAULTS.maxVolume),
      defaultVolume: clampInt(device.defaultVolume, 0, 100, DEFAULTS.defaultVolume),
      restoreVolumeOnSourceSwitch: boolOr(
        device.restoreVolumeOnSourceSwitch,
        DEFAULTS.restoreVolumeOnSourceSwitch
      ),
      exposeVolumeAsLightbulb: boolOr(
        device.exposeVolumeAsLightbulb,
        DEFAULTS.exposeVolumeAsLightbulb
      ),
      volumeStep: clampInt(device.volumeStep, 1, 25, DEFAULTS.volumeStep),
      sources: Array.isArray(device.sources) ? device.sources : null,
      hideSources: Array.isArray(device.hideSources) ? device.hideSources : null,
    };
  }

  async discoverDevices() {
    const devices = this.resolveDevices();
    if (devices.length === 0) {
      this.log.error(
        'No device configured. Set "ip" (or a "devices" array) in config.'
      );
      return;
    }

    for (const rawDevice of devices) {
      const device = this.withDefaults(rawDevice);
      if (!device.ip) {
        this.log.error(`Skipping "${device.name}": no ip configured.`);
        continue;
      }
      await this.setupDevice(device);
    }
  }

  async setupDevice(device) {
    const client = new DevialetClient({
      ip: device.ip,
      port: device.port,
      timeout: Math.max(2000, (device.pollInterval - 1) * 1000),
      log: (msg) => this.log.debug(`[${device.name}] ${msg}`),
    });

    const info = await this.fetchWithRetry(device, client);
    if (!info) {
      this.log.error(
        `[${device.name}] Could not reach speaker at ${device.ip} after ` +
          `${STARTUP_RETRIES} attempts. It may be offline. Skipping for now.`
      );
      return;
    }

    let sources = info.sources;
    if (device.sources) {
      const whitelist = new Set(device.sources);
      sources = sources.filter(
        (s) => whitelist.has(s.type) || whitelist.has(s.sourceId)
      );
      if (sources.length === 0) {
        this.log.warn(
          `[${device.name}] Source whitelist matched nothing; using all sources.`
        );
        sources = info.sources;
      }
    }
    if (device.hideSources && device.hideSources.length > 0) {
      const blocked = new Set(device.hideSources);
      const filtered = sources.filter(
        (s) => !blocked.has(s.type) && !blocked.has(s.sourceId)
      );
      if (filtered.length === 0) {
        this.log.warn(
          `[${device.name}] hideSources would remove every source; ignoring it.`
        );
      } else {
        sources = filtered;
      }
    }

    const uuid = this.api.hap.uuid.generate(`devialet-${device.ip}`);
    const accessory = new this.api.platformAccessory(
      device.name,
      uuid,
      this.api.hap.Categories.TELEVISION
    );

    const handler = new DevialetAccessory(this, accessory, {
      device,
      client,
      deviceInfo: info.deviceInfo,
      sources,
    });
    this.handlers.push(handler);

    this.api.publishExternalAccessories(PLUGIN_NAME, [accessory]);
    this.log.info(
      `[${device.name}] Published TV accessory with ${sources.length} source(s).`
    );
  }

  async fetchWithRetry(device, client) {
    for (let attempt = 1; attempt <= STARTUP_RETRIES; attempt++) {
      try {
        const deviceInfo = await client.getDeviceInfo();
        const sources = await client.getSources();
        return { deviceInfo, sources };
      } catch (err) {
        this.log.warn(
          `[${device.name}] Startup probe ${attempt}/${STARTUP_RETRIES} ` +
            `failed: ${err.message}`
        );
        if (attempt < STARTUP_RETRIES) {
          await delay(STARTUP_RETRY_DELAY);
        }
      }
    }
    return null;
  }
}

function numberOr(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function boolOr(value, fallback) {
  return typeof value === "boolean" ? value : fallback;
}

function clampInt(value, min, max, fallback) {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, n));
}

module.exports = { DevialetPlatform, PLATFORM_NAME };
