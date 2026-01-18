const crypto = require("crypto");

function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function createDeviceToken(deviceId, secret) {
  // simple token; you can later replace with JWT if you want
  return crypto.createHmac("sha256", secret).update(deviceId + ":" + Date.now()).digest("hex");
}

module.exports = { hashToken, createDeviceToken };
