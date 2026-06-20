"use strict";

const PLATFORM_NAME = "DevialetPhantom";
const PLUGIN_NAME = "homebridge-devialet-phantom";

const DEFAULTS = {
  pollInterval: 7,
  maxVolume: 60,
  defaultVolume: 35,
  restoreVolumeOnSourceSwitch: true,
  exposeVolumeAsLightbulb: false,
  volumeStep: 2,
};

// Devialet source "type" -> user-visible label shown in Apple Home.
// Labels are intentionally German per the spec; unmapped types fall back to the
// raw type string.
const SOURCE_LABELS = {
  optical: "Optisch",
  opticaljack: "Optisch",
  airplay2: "AirPlay",
  airplay: "AirPlay",
  bluetooth: "Bluetooth",
  spotifyconnect: "Spotify Connect",
  spotify: "Spotify Connect",
  raat: "Roon",
  upnp: "UPnP / DLNA",
  optical2: "Optisch 2",
  line: "Line-In",
  linein: "Line-In",
};

function labelForType(type) {
  if (!type) {
    return "Source";
  }
  return SOURCE_LABELS[type] || type;
}

module.exports = {
  PLATFORM_NAME,
  PLUGIN_NAME,
  DEFAULTS,
  SOURCE_LABELS,
  labelForType,
};
