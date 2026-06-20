"use strict";

// Standalone test (no framework). Spins up a mock HTTP server that mimics the
// Devialet IP Control API and exercises DevialetClient against it.
// Run: node test/devialetClient.test.js

const http = require("http");
const assert = require("assert");
const { DevialetClient } = require("../src/devialetClient");

let failures = 0;
const calls = [];

function ok(name) {
  console.log(`ok - ${name}`);
}
function fail(name, err) {
  failures++;
  console.error(`not ok - ${name}: ${err && err.message}`);
}

const server = http.createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    calls.push({ method: req.method, url: req.url, body });
    const send = (obj) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(obj));
    };
    const p = req.url;
    if (p === "/ipcontrol/v1/devices/current") {
      return send({ model: "Phantom 108 dB", serial: "X", release: { version: "2.19.1" } });
    }
    if (p === "/ipcontrol/v1/groups/current/sources/") {
      return send({
        sources: [
          { sourceId: "id-optical", type: "optical", streamLockAvailable: true },
          { sourceId: "id-airplay", type: "airplay2" },
        ],
      });
    }
    if (p === "/ipcontrol/v1/groups/current/sources/current") {
      return send({
        source: { sourceId: "id-airplay", type: "airplay2" },
        playingState: "playing",
        muteState: "unmuted",
        availableOperations: ["pause"],
      });
    }
    if (p === "/ipcontrol/v1/groups/current/sources/current/soundControl/volume") {
      if (req.method === "GET") return send({ volume: 42 });
      return send({});
    }
    if (p.endsWith("/playback/play") || p.endsWith("/playback/pause")) {
      return send({});
    }
    res.writeHead(404);
    res.end("{}");
  });
});

async function run() {
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const port = server.address().port;
  const client = new DevialetClient({ ip: "127.0.0.1", port, timeout: 2000 });

  try {
    const info = await client.getDeviceInfo();
    assert.strictEqual(info.model, "Phantom 108 dB");
    ok("getDeviceInfo");
  } catch (e) {
    fail("getDeviceInfo", e);
  }

  try {
    const sources = await client.getSources();
    assert.strictEqual(sources.length, 2);
    assert.strictEqual(sources[0].type, "optical");
    ok("getSources");
  } catch (e) {
    fail("getSources", e);
  }

  try {
    const vol = await client.getVolume();
    assert.strictEqual(vol, 42);
    ok("getVolume");
  } catch (e) {
    fail("getVolume", e);
  }

  try {
    await client.setVolume(55);
    const last = calls[calls.length - 1];
    assert.strictEqual(last.method, "POST");
    assert.deepStrictEqual(JSON.parse(last.body), { volume: 55 });
    ok("setVolume sends POST body");
  } catch (e) {
    fail("setVolume sends POST body", e);
  }

  try {
    await client.switchSource("id-optical");
    const last = calls[calls.length - 1];
    assert.strictEqual(
      last.url,
      "/ipcontrol/v1/groups/current/sources/id-optical/playback/play"
    );
    ok("switchSource targets sourceId UUID");
  } catch (e) {
    fail("switchSource targets sourceId UUID", e);
  }

  try {
    const state = await client.getState();
    assert.strictEqual(state.reachable, true);
    assert.strictEqual(state.sourceId, "id-airplay");
    assert.strictEqual(state.volume, 42);
    assert.strictEqual(state.playingState, "playing");
    ok("getState aggregates current source + volume");
  } catch (e) {
    fail("getState aggregates current source + volume", e);
  }

  // Reachability: a closed port must reject, not hang.
  try {
    const dead = new DevialetClient({ ip: "127.0.0.1", port: 1, timeout: 1000 });
    let threw = false;
    try {
      await dead.getVolume();
    } catch (_) {
      threw = true;
    }
    assert.strictEqual(threw, true);
    ok("unreachable speaker rejects");
  } catch (e) {
    fail("unreachable speaker rejects", e);
  }

  server.close();
  if (failures > 0) {
    console.error(`\n${failures} test(s) failed`);
    process.exit(1);
  }
  console.log("\nall tests passed");
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
