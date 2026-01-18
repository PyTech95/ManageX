require("dotenv").config();
const express = require("express");
const http = require("http");
const cors = require("cors");
const helmet = require("helmet");
const morgan = require("morgan");
const mongoose = require("mongoose");
const { Server } = require("socket.io");

const deviceRoutes = require("./src/routes/deviceRoutes");
const usageRoutes = require("./src/routes/usageRoutes");
const adminRoutes = require("./src/routes/adminRoutes");
const { authAdmin } = require("./src/middleware/authAdmin");

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: { origin: process.env.CORS_ORIGIN, credentials: true },
});

// Make io available in routes
app.set("io", io);

app.use(helmet());
app.use(cors({ origin: process.env.CORS_ORIGIN, credentials: true }));
app.use(express.json({ limit: "1mb" }));
app.use(morgan("dev"));

app.get("/", (_, res) => res.json({ ok: true, name: "ManageX" }));

app.use("/api/admin", adminRoutes);
app.use("/api/device", deviceRoutes);
app.use("/api/usage", usageRoutes);

// Admin socket (optional)
io.on("connection", (socket) => {
  socket.on("join-device", ({ deviceId }) => {
    socket.join(`device:${deviceId}`);
  });

  socket.on("join-admin", () => socket.join("admins"));
});

(async () => {
  await mongoose.connect(process.env.MONGO_URI);
  console.log("Mongo connected");

  server.listen(process.env.PORT, () => {
    console.log(`Backend running on :${process.env.PORT}`);
  });
})();
