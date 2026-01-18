const express = require("express");
const geoip = require("geoip-lite");
const Device = require("../models/Device");
const { createDeviceToken, hashToken } = require("../utils/crypto");
const { authDevice } = require("../middleware/authDevice");
const { authAdmin } = require("../middleware/authAdmin");

const router = express.Router();

/**
 * Register device (agent)
 */
router.post("/register", async (req, res) => {
  const { deviceId, username, os, model } = req.body;

  if (!deviceId) return res.status(400).json({ error: "deviceId required" });

  const deviceToken = createDeviceToken(
    deviceId,
    process.env.DEVICE_TOKEN_SECRET,
  );

  const doc = await Device.findOneAndUpdate(
    { deviceId },
    {
      deviceId,
      username,
      os,
      model,
      deviceTokenHash: hashToken(deviceToken),
      status: { online: true, lastSeen: new Date() },
    },
    { upsert: true, new: true },
  );

  return res.json({ deviceToken, device: { deviceId: doc.deviceId } });
});

/**
 * Heartbeat (agent) + IP-based location
 */
router.post("/heartbeat", authDevice, async (req, res) => {
  const io = req.app.get("io");
  const device = req.device;

  const ip =
    (req.headers["x-forwarded-for"] || "").split(",")[0].trim() ||
    req.socket.remoteAddress ||
    "";

  const geo = geoip.lookup(ip.replace("::ffff:", ""));
  const location = geo
    ? {
        method: "IP",
        ip,
        city: geo.city,
        region: geo.region,
        country: geo.country,
        lat: geo.ll?.[0],
        lng: geo.ll?.[1],
        timestamp: new Date(),
      }
    : { method: "IP", ip, timestamp: new Date() };

  device.status.online = true;
  device.status.lastSeen = new Date();
  device.lastLocation = { ...(device.lastLocation || {}), ...location };

  await device.save();

  // Push updates to admins in real-time
  io.to("admins").emit("device-update", {
    deviceId: device.deviceId,
    online: true,
    lastSeen: device.status.lastSeen,
    lastLocation: device.lastLocation,
    lockState: device.lockState,
  });

  res.json({ ok: true });
});

/**
 * Receive WIN lat/lng (optional helper or agent)
 */
router.post("/location", authDevice, async (req, res) => {
  const { lat, lng, accuracyMeters } = req.body;
  const device = req.device;

  if (typeof lat !== "number" || typeof lng !== "number") {
    return res.status(400).json({ error: "lat and lng must be numbers" });
  }

  device.lastLocation = {
    ...(device.lastLocation || {}), // keep ip/city/region/country if present
    method: "WIN",
    lat,
    lng,
    accuracyMeters,
    timestamp: new Date(),
  };

  await device.save();

  // Optional: push update to admins instantly
  const io = req.app.get("io");
  io.to("admins").emit("device-update", {
    deviceId: device.deviceId,
    online: device.status?.online ?? true,
    lastSeen: device.status?.lastSeen,
    lastLocation: device.lastLocation,
    lockState: device.lockState,
  });

  res.json({ ok: true });
});

/**
 * Admin: list devices
 */
router.get("/list", authAdmin, async (_req, res) => {
  const devices = await Device.find().sort({ updatedAt: -1 }).lean();

  const OFFLINE_AFTER_MS = 2 * 60 * 1000; // 2 minutes (change to 5 min if you want)
  const now = Date.now();

  const computed = devices.map((d) => {
    const lastSeen = d?.status?.lastSeen
      ? new Date(d.status.lastSeen).getTime()
      : 0;
    const isOnline = lastSeen && now - lastSeen <= OFFLINE_AFTER_MS;

    return {
      ...d,
      status: {
        ...(d.status || {}),
        online: isOnline,
      },
    };
  });

  res.json({ devices: computed });
});

router.get("/:deviceId/details", authAdmin, async (req, res) => {
  const { deviceId } = req.params;

  const device = await Device.findOne({ deviceId }).lean();
  if (!device) return res.status(404).json({ error: "Device not found" });

  const today = new Date().toISOString().slice(0, 10);

  // Today's count
  const DailySummary = require("../models/DailySummary");
  const summary = await DailySummary.findOne({ deviceId, date: today }).lean();

  // Today's used software list
  const SoftwareUsage = require("../models/SoftwareUsage");
  const usage = await SoftwareUsage.find({ deviceId, date: today })
    .sort({ totalMinutes: -1, lastSeen: -1 })
    .lean();

  res.json({
    device,
    today,
    summary: summary || { deviceId, date: today, softwareCount: 0 },
    usage,
  });
});
const SoftwareUsage = require("../models/SoftwareUsage");

function todayUTC() {
  return new Date().toISOString().slice(0, 10);
}
router.get("/:deviceId/software-today", authAdmin, async (req, res) => {
  const { deviceId } = req.params;
  const date = todayUTC();

  const usage = await SoftwareUsage.find({ deviceId, date })
    .sort({ softwareName: 1 })
    .lean();

  res.json({ deviceId, date, usage });
});
/**
 * Admin: lock/unlock (real-time command)
 */
router.post("/:deviceId/command", authAdmin, async (req, res) => {
  const io = req.app.get("io");
  const { deviceId } = req.params;
  const { command } = req.body; // "LOCK" or "UNLOCK"

  const device = await Device.findOne({ deviceId });
  if (!device) return res.status(404).json({ error: "Device not found" });

  // emit command to device room
  io.to(`device:${deviceId}`).emit("command", {
    command,
    message: "Device locked by Admin. Please contact IT support.",
  });

  // optimistically store state
  device.lockState = command === "LOCK" ? "LOCKED" : "UNLOCKED";
  await device.save();

  res.json({ ok: true });
});

module.exports = router;
