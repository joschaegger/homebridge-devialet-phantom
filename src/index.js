"use strict";

const { PLATFORM_NAME } = require("./settings");
const { DevialetPlatform } = require("./platform");

module.exports = (api) => {
  api.registerPlatform(PLATFORM_NAME, DevialetPlatform);
};
