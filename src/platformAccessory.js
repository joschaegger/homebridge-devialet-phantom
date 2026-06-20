"use strict";

const { labelForType } = require("./settings");

const SWITCH_RESTORE_DELAY = 1500;

// Maps Devialet source "type" -> HomeKit InputSourceType for nicer icons.
function inputSourceType(Characteristic, type) {
  switch (type) {
    case "airplay2":
    case "airplay":
      return Characteristic.InputSourceType.AIRPLAY;
    case "optical":
    case "opticaljack":
    case "optical2":
      return Characteristic.InputSourceType.OTHER;
    case "bluetooth":
      return Characteristic.InputSourceType.OTHER;
    case "line":
    case "linein":
      return Characteristic.InputSourceType.OTHER;
    default:
      return Characteristic.InputSourceType.APPLICATION;
  }
}

class DevialetAccessory {
  constructor(platform, accessory, context) {
    this.platform = platform;
    this.log = platform.log;
    this.Service = platform.Service;
    this.Characteristic = platform.Characteristic;
    this.accessory = accessory;

    this.device = context.device;
    this.client = context.client;
    this.deviceInfo = context.deviceInfo || {};
    this.sources = context.sources || [];

    this.reachable = true;
    this.lastKnownVolume = this.device.defaultVolume;
    this.preMuteVolume = this.device.defaultVolume;
    this.currentIdentifier = 0;

    this.identifierToSourceId = new Map();
    this.sourceIdToIdentifier = new Map();

    this.setupInformationService();
    this.setupTelevisionService();
    this.setupInputSources();
    this.setupSpeakerService();
    if (this.device.exposeVolumeAsLightbulb) {
      this.setupLightbulbService();
    }
    this.startPolling();
  }

  clampVolume(value) {
    const n = Math.round(Number(value));
    if (!Number.isFinite(n)) {
      return 0;
    }
    return Math.min(this.device.maxVolume, Math.max(0, n));
  }

  setupInformationService() {
    const info =
      this.accessory.getService(this.Service.AccessoryInformation) ||
      this.accessory.addService(this.Service.AccessoryInformation);
    const release = this.deviceInfo.release || {};
    info
      .setCharacteristic(this.Characteristic.Manufacturer, "Devialet")
      .setCharacteristic(
        this.Characteristic.Model,
        this.deviceInfo.model || "Phantom"
      )
      .setCharacteristic(
        this.Characteristic.SerialNumber,
        this.deviceInfo.serial || this.device.ip
      )
      .setCharacteristic(
        this.Characteristic.FirmwareRevision,
        release.version || "0.0.0"
      );
  }

  setupTelevisionService() {
    const tv =
      this.accessory.getService(this.Service.Television) ||
      this.accessory.addService(this.Service.Television, this.device.name);
    this.tvService = tv;

    tv.setCharacteristic(this.Characteristic.ConfiguredName, this.device.name);
    tv.setCharacteristic(
      this.Characteristic.SleepDiscoveryMode,
      this.Characteristic.SleepDiscoveryMode.ALWAYS_DISCOVERABLE
    );

    tv.getCharacteristic(this.Characteristic.Active)
      .onGet(() =>
        this.reachable
          ? this.Characteristic.Active.ACTIVE
          : this.Characteristic.Active.INACTIVE
      )
      .onSet(async (value) => {
        // No confirmed standby endpoint on this firmware -> map the TV power
        // toggle to play/pause as a best-effort approximation.
        try {
          if (value === this.Characteristic.Active.ACTIVE) {
            await this.client.play();
          } else {
            await this.client.pause();
          }
        } catch (err) {
          this.log.warn(`[${this.device.name}] Active set failed: ${err.message}`);
        }
      });

    tv.getCharacteristic(this.Characteristic.ActiveIdentifier)
      .onGet(() => this.currentIdentifier)
      .onSet((value) => this.handleSourceSwitch(value));

    tv.getCharacteristic(this.Characteristic.RemoteKey).onSet((key) =>
      this.handleRemoteKey(key)
    );
  }

  setupInputSources() {
    this.sources.forEach((source, index) => {
      const identifier = index + 1;
      this.identifierToSourceId.set(identifier, source.sourceId);
      this.sourceIdToIdentifier.set(source.sourceId, identifier);

      const label = labelForType(source.type);
      const subtype = `input-${source.sourceId}`;
      const inputService =
        this.accessory.getServiceById(this.Service.InputSource, subtype) ||
        this.accessory.addService(this.Service.InputSource, label, subtype);

      inputService
        .setCharacteristic(this.Characteristic.Identifier, identifier)
        .setCharacteristic(this.Characteristic.ConfiguredName, label)
        .setCharacteristic(
          this.Characteristic.IsConfigured,
          this.Characteristic.IsConfigured.CONFIGURED
        )
        .setCharacteristic(
          this.Characteristic.InputSourceType,
          inputSourceType(this.Characteristic, source.type)
        )
        .setCharacteristic(
          this.Characteristic.CurrentVisibilityState,
          this.Characteristic.CurrentVisibilityState.SHOWN
        );

      this.tvService.addLinkedService(inputService);
    });
  }

  setupSpeakerService() {
    const speaker =
      this.accessory.getService(this.Service.TelevisionSpeaker) ||
      this.accessory.addService(
        this.Service.TelevisionSpeaker,
        `${this.device.name} Speaker`,
        "speaker"
      );
    this.speakerService = speaker;

    speaker
      .setCharacteristic(
        this.Characteristic.Active,
        this.Characteristic.Active.ACTIVE
      )
      .setCharacteristic(
        this.Characteristic.VolumeControlType,
        this.Characteristic.VolumeControlType.ABSOLUTE
      );

    speaker
      .getCharacteristic(this.Characteristic.VolumeSelector)
      .onSet((direction) => this.handleVolumeSelector(direction));

    speaker
      .getCharacteristic(this.Characteristic.Volume)
      .onGet(() => this.clampVolume(this.lastKnownVolume))
      .onSet((value) => this.handleVolumeSet(value));

    speaker
      .getCharacteristic(this.Characteristic.Mute)
      .onGet(() => this.lastKnownVolume === 0)
      .onSet((value) => this.handleMute(value));

    this.tvService.addLinkedService(speaker);
  }

  setupLightbulbService() {
    // Optional true-percentage slider. Name must not contain "Volume" or Apple
    // Home applies unwanted magic.
    const bulb =
      this.accessory.getService(this.Service.Lightbulb) ||
      this.accessory.addService(
        this.Service.Lightbulb,
        `${this.device.name} Pegel`,
        "volume-bulb"
      );
    this.lightbulbService = bulb;

    bulb
      .getCharacteristic(this.Characteristic.On)
      .onGet(() => this.reachable && this.lastKnownVolume > 0)
      .onSet((value) => this.handleBulbOn(value));

    bulb
      .getCharacteristic(this.Characteristic.Brightness)
      .onGet(() => this.clampVolume(this.lastKnownVolume))
      .onSet((value) => this.handleVolumeSet(value));
  }

  async handleSourceSwitch(identifier) {
    const sourceId = this.identifierToSourceId.get(identifier);
    if (!sourceId) {
      this.log.warn(
        `[${this.device.name}] Unknown source identifier ${identifier}.`
      );
      return;
    }
    this.currentIdentifier = identifier;
    try {
      await this.client.switchSource(sourceId);
      this.log.info(`[${this.device.name}] Switched source.`);
      if (this.device.restoreVolumeOnSourceSwitch) {
        this.scheduleVolumeRestore();
      }
    } catch (err) {
      this.log.warn(`[${this.device.name}] Source switch failed: ${err.message}`);
    }
  }

  scheduleVolumeRestore() {
    // The firmware resets volume to a fixed default (~35) on source switch.
    // Re-apply the last known volume shortly after the switch settles.
    const target = this.clampVolume(
      this.lastKnownVolume > 0 ? this.lastKnownVolume : this.device.defaultVolume
    );
    setTimeout(async () => {
      try {
        await this.client.setVolume(target);
        this.applyVolumeToCharacteristics(target);
        this.log.debug(`[${this.device.name}] Restored volume to ${target}.`);
      } catch (err) {
        this.log.debug(
          `[${this.device.name}] Volume restore failed: ${err.message}`
        );
      }
    }, SWITCH_RESTORE_DELAY);
  }

  async handleVolumeSelector(direction) {
    const step =
      direction === this.Characteristic.VolumeSelector.INCREMENT
        ? this.device.volumeStep
        : -this.device.volumeStep;
    const target = this.clampVolume(this.lastKnownVolume + step);
    await this.handleVolumeSet(target);
  }

  async handleVolumeSet(value) {
    const target = this.clampVolume(value);
    try {
      await this.client.setVolume(target);
      if (target > 0) {
        this.preMuteVolume = target;
      }
      this.applyVolumeToCharacteristics(target);
    } catch (err) {
      this.log.warn(`[${this.device.name}] Set volume failed: ${err.message}`);
    }
  }

  async handleMute(shouldMute) {
    if (shouldMute) {
      if (this.lastKnownVolume > 0) {
        this.preMuteVolume = this.lastKnownVolume;
      }
      await this.handleVolumeSet(0);
    } else {
      await this.handleVolumeSet(this.preMuteVolume || this.device.defaultVolume);
    }
  }

  async handleBulbOn(value) {
    if (value) {
      const target = this.preMuteVolume || this.device.defaultVolume;
      await this.handleVolumeSet(target);
    } else {
      await this.handleMute(true);
    }
  }

  async handleRemoteKey(key) {
    const Key = this.Characteristic.RemoteKey;
    try {
      if (key === Key.PLAY_PAUSE) {
        const state = await this.client.getCurrentSource();
        if (state.playingState === "playing") {
          await this.client.pause();
        } else {
          await this.client.play();
        }
      } else if (key === Key.ARROW_UP) {
        await this.handleVolumeSelector(
          this.Characteristic.VolumeSelector.INCREMENT
        );
      } else if (key === Key.ARROW_DOWN) {
        await this.handleVolumeSelector(
          this.Characteristic.VolumeSelector.DECREMENT
        );
      }
    } catch (err) {
      this.log.debug(`[${this.device.name}] Remote key failed: ${err.message}`);
    }
  }

  applyVolumeToCharacteristics(volume) {
    this.lastKnownVolume = volume;
    this.speakerService.updateCharacteristic(this.Characteristic.Volume, volume);
    this.speakerService.updateCharacteristic(
      this.Characteristic.Mute,
      volume === 0
    );
    if (this.lightbulbService) {
      this.lightbulbService.updateCharacteristic(
        this.Characteristic.On,
        volume > 0
      );
      this.lightbulbService.updateCharacteristic(
        this.Characteristic.Brightness,
        volume
      );
    }
  }

  startPolling() {
    const intervalMs = Math.max(2000, this.device.pollInterval * 1000);
    this.poll();
    this.pollTimer = setInterval(() => this.poll(), intervalMs);
    if (this.pollTimer.unref) {
      this.pollTimer.unref();
    }
  }

  async poll() {
    try {
      const state = await this.client.getState();
      if (!this.reachable) {
        this.log.info(`[${this.device.name}] Speaker back online.`);
      }
      this.reachable = true;
      this.tvService.updateCharacteristic(
        this.Characteristic.Active,
        this.Characteristic.Active.ACTIVE
      );

      if (state.sourceId && this.sourceIdToIdentifier.has(state.sourceId)) {
        const identifier = this.sourceIdToIdentifier.get(state.sourceId);
        this.currentIdentifier = identifier;
        this.tvService.updateCharacteristic(
          this.Characteristic.ActiveIdentifier,
          identifier
        );
      }

      if (typeof state.volume === "number") {
        const display = this.clampVolume(state.volume);
        this.applyVolumeToCharacteristics(display);
      }
    } catch (err) {
      if (this.reachable) {
        this.log.warn(
          `[${this.device.name}] Speaker unreachable: ${err.message}. ` +
            `Marking inactive, will keep polling.`
        );
      }
      this.reachable = false;
      this.tvService.updateCharacteristic(
        this.Characteristic.Active,
        this.Characteristic.Active.INACTIVE
      );
    }
  }

  stop() {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }
}

module.exports = { DevialetAccessory };
