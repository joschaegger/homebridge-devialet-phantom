"use strict";

const http = require("http");

const BASE_PATH = "/ipcontrol/v1";

// Thin, dependency-free client for the Devialet IP Control API.
// HTTP only, port 80, no auth. All methods return promises and throw on
// transport errors or non-2xx responses so callers can handle reachability.
class DevialetClient {
  constructor(options) {
    options = options || {};
    this.ip = options.ip;
    this.port = options.port || 80;
    this.timeout = options.timeout || 5000;
    this.log = options.log || (() => {});
    if (!this.ip) {
      throw new Error("DevialetClient requires an ip");
    }
  }

  request(method, path, body) {
    const payload = body === undefined ? undefined : JSON.stringify(body);
    const headers = {};
    if (payload !== undefined) {
      headers["Content-Type"] = "application/json";
      headers["Content-Length"] = Buffer.byteLength(payload);
    }

    const requestOptions = {
      host: this.ip,
      port: this.port,
      method,
      path: BASE_PATH + path,
      headers,
      timeout: this.timeout,
    };

    return new Promise((resolve, reject) => {
      const req = http.request(requestOptions, (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => {
          const raw = Buffer.concat(chunks).toString("utf8");
          const status = res.statusCode || 0;
          if (status < 200 || status >= 300) {
            const err = new Error(
              `Devialet ${method} ${path} -> HTTP ${status}`
            );
            err.statusCode = status;
            err.body = raw;
            reject(err);
            return;
          }
          if (!raw) {
            resolve({});
            return;
          }
          try {
            resolve(JSON.parse(raw));
          } catch (parseError) {
            // Some action endpoints return an empty/non-JSON 200 body.
            resolve({ raw });
          }
        });
      });

      req.on("error", (err) => reject(err));
      req.on("timeout", () => {
        req.destroy(new Error(`Devialet ${method} ${path} timed out`));
      });

      if (payload !== undefined) {
        req.write(payload);
      }
      req.end();
    });
  }

  getSystemInfo() {
    return this.request("GET", "/systems/current");
  }

  getDeviceInfo() {
    return this.request("GET", "/devices/current");
  }

  // Returns the raw source list: [{ deviceId, sourceId, type, [streamLockAvailable] }]
  async getSources() {
    const data = await this.request("GET", "/groups/current/sources/");
    return Array.isArray(data.sources) ? data.sources : [];
  }

  getCurrentSource() {
    return this.request("GET", "/groups/current/sources/current");
  }

  async getVolume() {
    const data = await this.request(
      "GET",
      "/groups/current/sources/current/soundControl/volume"
    );
    return typeof data.volume === "number" ? data.volume : null;
  }

  setVolume(volume) {
    return this.request(
      "POST",
      "/groups/current/sources/current/soundControl/volume",
      { volume }
    );
  }

  switchSource(sourceId) {
    return this.request(
      "POST",
      `/groups/current/sources/${sourceId}/playback/play`,
      {}
    );
  }

  play() {
    return this.request(
      "POST",
      "/groups/current/sources/current/playback/play",
      {}
    );
  }

  pause() {
    return this.request(
      "POST",
      "/groups/current/sources/current/playback/pause",
      {}
    );
  }

  // Convenience: a single round-trip used by the poll loop.
  // Returns { reachable, source, type, sourceId, volume, playingState, muteState, availableOperations }
  async getState() {
    const current = await this.getCurrentSource();
    let volume = null;
    try {
      volume = await this.getVolume();
    } catch (err) {
      this.log(`getVolume failed: ${err.message}`);
    }
    const source = current.source || {};
    return {
      reachable: true,
      sourceId: source.sourceId || null,
      type: source.type || null,
      volume,
      playingState: current.playingState || null,
      muteState: current.muteState || null,
      availableOperations: Array.isArray(current.availableOperations)
        ? current.availableOperations
        : [],
    };
  }
}

module.exports = { DevialetClient, BASE_PATH };
