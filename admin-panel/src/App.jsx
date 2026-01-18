import { useEffect, useMemo, useState } from "react";
import axios from "axios";
import { io } from "socket.io-client";
import { toast } from "sonner";
import { MapPin, Eye, X } from "lucide-react";
import manageXLogo from "./assets/mangeX.png"

const API = "https://managexbackend.onrender.com";

/* ================= Helpers ================= */
function getQueryParam(name) {
  return new URLSearchParams(window.location.search).get(name);
}

function formatDateTime(v) {
  if (!v) return "—";
  try {
    return new Date(v).toLocaleString();
  } catch {
    return "—";
  }
}

function LocationCell({ loc }) {
  // 1) City-based (IP geo / reverse geo)
  if (loc?.city) {
    const region = loc?.region ? `, ${loc.region}` : "";
    const country = loc?.country ? `, ${loc.country}` : "";
    return <span>{`${loc.city}${region}${country}`}</span>;
  }

  // 2) Lat/Lng-based (WIN location)
  if (typeof loc?.lat === "number" && typeof loc?.lng === "number") {
    const mapsUrl = `https://www.google.com/maps?q=${loc.lat},${loc.lng}`;
    return (
      <a
        href={mapsUrl}
        target="_blank"
        rel="noreferrer"
        title={`${loc.lat.toFixed(4)}, ${loc.lng.toFixed(4)}`}
      >
        <MapPin size={18} className="text-red-500" />
      </a>
    );
  }

  return <span className="text-gray-400">N/A</span>;
}

/* ================= New Tab Page: Software Used Today ================= */
function SoftwarePage({ apiBase }) {
  const deviceId = getQueryParam("deviceId");
  const token = localStorage.getItem("mdm_token") || "";
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState({ deviceId: "", date: "", usage: [] });

  useEffect(() => {
    async function load() {
      setLoading(true);
      try {
        const res = await axios.get(
          `${apiBase}/api/device/${encodeURIComponent(deviceId)}/software-today`,
          { headers: { Authorization: `Bearer ${token}` } }
        );
        setData(res.data);
      } catch {
        toast.error("Failed to load software list");
        setData({ deviceId, date: "", usage: [] });
      } finally {
        setLoading(false);
      }
    }

    if (deviceId && token) load();
    else setLoading(false);
  }, [deviceId, token, apiBase]);

  const total = data?.usage?.length || 0;

  return (
    <div className="min-h-screen bg-gradient-to-b from-gray-50 to-gray-100 p-6">
      <div className="max-w-4xl mx-auto">
        <div className="bg-white rounded-2xl shadow-xl overflow-hidden">
          <div className="px-6 py-5 border-b">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h1 className="text-2xl font-semibold">Software Used Today</h1>
                <p className="text-sm text-gray-500 mt-1">
                  Device: <span className="font-mono">{deviceId}</span> • Date:{" "}
                  <span className="font-medium">{data.date || "—"}</span>
                </p>
              </div>

              <button
                onClick={() => window.close()}
                className="px-3 py-2 rounded-xl bg-gray-100 hover:bg-gray-200 text-sm font-medium"
              >
                Close Tab
              </button>
            </div>
          </div>

          <div className="px-6 py-5">
            {loading ? (
              <div className="text-gray-500">Loading...</div>
            ) : (
              <>
                <div className="flex items-center justify-between mb-4">
                  <div className="text-sm text-gray-600">
                    Total Software: <span className="font-semibold">{total}</span>
                  </div>
                </div>

                <div className="border rounded-2xl overflow-hidden">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-100">
                      <tr>
                        <th className="p-3 text-left">Software Name</th>
                        <th className="p-3 text-left">First Seen</th>
                        <th className="p-3 text-left">Last Seen</th>
                        <th className="p-3 text-left">Minutes</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.usage?.length ? (
                        data.usage.map((u) => (
                          <tr key={u._id} className="border-t hover:bg-gray-50">
                            <td className="p-3 font-medium">{u.softwareName}</td>
                            <td className="p-3">
                              {u.firstSeen ? new Date(u.firstSeen).toLocaleTimeString() : "—"}
                            </td>
                            <td className="p-3">
                              {u.lastSeen ? new Date(u.lastSeen).toLocaleTimeString() : "—"}
                            </td>
                            <td className="p-3">{u.totalMinutes ?? 0}</td>
                          </tr>
                        ))
                      ) : (
                        <tr>
                          <td colSpan="4" className="p-6 text-center text-gray-400">
                            No software usage recorded today
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>

                <p className="mt-4 text-xs text-gray-500">
                  Tip: Next, we can add search + date picker here.
                </p>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ================= Main App ================= */
export default function App() {
  // If opened in new tab for software list
  const view = getQueryParam("view");
  if (view === "software") return <SoftwarePage apiBase={API} />;

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const [token, setToken] = useState(localStorage.getItem("mdm_token") || "");
  const [devices, setDevices] = useState([]);
  const [loading, setLoading] = useState(false);

  const [selected, setSelected] = useState(null); // { device, summary, usage, today }
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [detailsLoading, setDetailsLoading] = useState(false);

  /* ================= LOGIN ================= */
  async function login(e) {
    e.preventDefault();
    setLoading(true);

    try {
      const res = await axios.post(`${API}/api/admin/login`, { email, password });
      setToken(res.data.token);
      localStorage.setItem("mdm_token", res.data.token);
      toast.success("Login successful");
    } catch {
      toast.error("Invalid email or password");
    } finally {
      setLoading(false);
    }
  }

  /* ================= LOAD DEVICES ================= */
  async function loadDevices(t) {
    try {
      const res = await axios.get(`${API}/api/device/list`, {
        headers: { Authorization: `Bearer ${t}` },
      });
      setDevices(res.data.devices || []);
    } catch {
      toast.error("Failed to load devices");
    }
  }

  /* ================= OPEN MODAL (DETAILS) ================= */
  async function openDetails(deviceId) {
    setDetailsLoading(true);
    setDetailsOpen(true);

    try {
      const res = await axios.get(`${API}/api/device/${deviceId}/details`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      setSelected(res.data);
    } catch {
      toast.error("Failed to load device details");
      setDetailsOpen(false);
      setSelected(null);
    } finally {
      setDetailsLoading(false);
    }
  }

  function openSoftwareTab(deviceId) {
    const url = `${window.location.origin}/?view=software&deviceId=${encodeURIComponent(deviceId)}`;
    window.open(url, "_blank");
  }

  /* ================= SEND COMMAND ================= */
  async function sendCommand(deviceId, command) {
    const toastId = toast.loading(`Sending ${command} command...`);
    try {
      await axios.post(
        `${API}/api/device/${deviceId}/command`,
        { command },
        { headers: { Authorization: `Bearer ${token}` } }
      );
      toast.success(`${command} command sent`, { id: toastId });
    } catch {
      toast.error("Command failed", { id: toastId });
    }
  }

  /* ================= SOCKET + INIT ================= */
  useEffect(() => {
    if (!token) return;

    loadDevices(token);

    const socket = io(API);
    socket.emit("join-admin");

    socket.on("device-update", (u) => {
      setDevices((prev) =>
        prev.map((d) => (d.deviceId === u.deviceId ? { ...d, ...u } : d))
      );
    });

    return () => socket.close();
  }, [token]);

  /* ================= LOGIN UI ================= */
  if (!token) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-b from-gray-100 to-gray-200 p-4">
        <form
          onSubmit={login}
          className="bg-white p-8 rounded-2xl shadow-xl w-full max-w-md"
        >
          <h2 className="text-2xl font-bold text-center">MDM Admin</h2>
          <p className="text-center text-gray-500 text-sm mb-6">
            Secure device management console
          </p>

          <div className="mb-4">
            <label className="text-sm font-medium">Email</label>
            <input
              type="email"
              className="w-full mt-1 border rounded-xl px-3 py-2 focus:ring focus:ring-blue-300 outline-none"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>

          <div className="mb-6">
            <label className="text-sm font-medium">Password</label>
            <input
              type="password"
              className="w-full mt-1 border rounded-xl px-3 py-2 focus:ring focus:ring-blue-300 outline-none"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>

          <button
            disabled={loading}
            className="w-full bg-blue-600 text-white py-2 rounded-xl hover:bg-blue-700 transition font-medium"
          >
            {loading ? "Logging in..." : "Login"}
          </button>
        </form>
      </div>
    );
  }

  /* ================= DASHBOARD UI ================= */
  return (
    <div className="min-h-screen bg-gradient-to-b from-gray-50 to-gray-100 p-6">
      <div className="max-w-7xl mx-auto">
        <div className="flex justify-between items-center mb-6">
          <div className="flex flex-col items-center">
          <img
            src={manageXLogo}
            alt="ManageX Logo"
            className="h-14 mb-2 mr-35"
          />

          <p className="text-center text-gray-500 text-sm">
             Monitor and control company devices in real time
          </p>
        </div>

          <button
            onClick={() => {
              setToken("");
              localStorage.removeItem("mdm_token");
            }}
            className="text-sm text-red-600 hover:underline"
          >
            Logout
          </button>
        </div>

        <div className="bg-white rounded-lg shadow-xl border-1 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-cyan-100">
              <tr>
                <th className="p-3 text-left">Device ID</th>
                <th className="p-3 text-left">User</th>
                <th className="p-3 text-left">Status</th>
                <th className="p-3 text-left">Last Seen</th>
                <th className="p-3 text-left">Location</th>
                <th className="p-3 text-left">Actions</th>
                <th className="p-3 text-left">Details</th>
              </tr>
            </thead>

            <tbody>
              {devices.map((d) => {
                const online = d?.status?.online ?? d.online;
                const lastSeen = d?.status?.lastSeen ?? d?.lastSeen;

                return (
                  <tr key={d.deviceId} className=" hover:bg-gray-50">
                    <td className="p-3 font-mono">{d.deviceId}</td>
                    <td className="p-3">{d.username || "—"}</td>

                    <td className="p-3">
                      <span
                        className={`px-3 py-1 rounded-full text-xs font-medium ${
                          online
                            ? "bg-green-100 text-green-700"
                            : "bg-red-100 text-red-700"
                        }`}
                      >
                        {online ? "Online" : "Offline"}
                      </span>
                    </td>

                    <td className="p-3">{formatDateTime(lastSeen)}</td>

                    <td className="p-3">
                      <LocationCell loc={d?.lastLocation} />
                    </td>

                    <td className="p-3">
                      <div className="flex flex-wrap gap-2">
                        <button
                          onClick={() => sendCommand(d.deviceId, "LOCK")}
                          className="px-3 py-1.5 text-xs font-medium rounded-xl bg-red-50 text-red-600 hover:bg-red-100"
                        >
                          Lock
                        </button>

                        <button
                          onClick={() => sendCommand(d.deviceId, "UNLOCK")}
                          className="px-3 py-1.5 text-xs font-medium rounded-xl bg-green-50 text-green-600 hover:bg-green-100"
                        >
                          Unlock
                        </button>
                      </div>
                    </td>
                    <td className="p-3">
                      <div className="flex flex-wrap gap-2">
                        <button
                          onClick={() => openDetails(d.deviceId)}
                          className="px-3 py-1.5 text-xs font-medium rounded-xl bg-blue-50 text-blue-700 hover:bg-blue-100 flex items-center gap-1"
                        >
                          <Eye size={16} />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}

              {devices.length === 0 && (
                <tr>
                  <td colSpan="6" className="text-center p-6 text-gray-400">
                    No devices found
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ================= MODAL ================= */}
      {detailsOpen && (
        <div
          className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4"
          onMouseDown={(e) => {
            // click outside to close
            if (e.target === e.currentTarget) {
              setDetailsOpen(false);
              setSelected(null);
            }
          }}
        >
          <div className="bg-white w-full max-w-xl max-h-[80vh] rounded-2xl shadow-2xl overflow-hidden flex flex-col">
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-2 border-b">
              <div>
                <h3 className="text-lg font-semibold">Device Details</h3>
                <p className="text-xs text-gray-500">
                  {selected?.device?.deviceId || "Loading..."}
                </p>
              </div>

              <div className="flex items-center gap-2">
                {selected?.device?.deviceId && (
                  <button
                    onClick={() => openSoftwareTab(selected.device.deviceId)}
                    className="px-3 py-2 rounded-xl bg-blue-600 text-white text-sm hover:bg-blue-700"
                  >
                    Details
                  </button>
                )}

                <button
                  onClick={() => {
                    setDetailsOpen(false);
                    setSelected(null);
                  }}
                  className="p-2 rounded-xl hover:bg-gray-100"
                  title="Close"
                >
                  <X size={18} />
                </button>
              </div>
            </div>

            <div className="p-2">
              {detailsLoading ? (
                <div className="text-sm text-gray-500">Loading details...</div>
              ) : !selected ? (
                <div className="text-sm text-gray-500">No data</div>
              ) : (
                <>
                  {/* Top info cards */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm">
                    <div className="bg-gray-50 rounded-2xl p-2">
                      <div className="text-xs text-gray-500">User</div>
                      <div className="font-semibold text-gray-900 mt-1">
                        {selected.device.username || "—"}
                      </div>
                    </div>

                    <div className="bg-gray-50 rounded-2xl p-2">
                      <div className="text-xs text-gray-500">OS</div>
                      <div className="font-semibold text-gray-900 mt-1">
                        {selected.device.os || "—"}
                      </div>
                    </div>

                    <div className="bg-gray-50 rounded-2xl p-2">
                      <div className="text-xs text-gray-500">Model</div>
                      <div className="font-semibold text-gray-900 mt-1">
                        {selected.device.model || "—"}
                      </div>
                    </div>

                    <div className="bg-gray-50 rounded-2xl p-2">
                      <div className="text-xs text-gray-500">Lock State</div>
                      <div className="font-semibold text-gray-900 mt-1">
                        {selected.device.lockState || "—"}
                      </div>
                    </div>

                    <div className="bg-gray-50 rounded-2xl p-2">
                      <div className="text-xs text-gray-500">Online</div>
                      <div className="font-semibold text-gray-900 mt-1">
                        {(selected.device.status?.online ?? false) ? "Online" : "Offline"}
                      </div>
                    </div>

                    <div className="bg-gray-50 rounded-2xl p-2">
                      <div className="text-xs text-gray-500">Last Seen</div>
                      <div className="font-semibold text-gray-900 mt-1">
                        {formatDateTime(selected.device.status?.lastSeen)}
                      </div>
                    </div>
                  </div>

                  {/* Location */}
                  <div className="mt-4 bg-gray-50 rounded-2xl p-2 text-sm">
                    <div className="text-xs text-gray-500 mb-1">Last Location</div>
                    {(() => {
                      const loc = selected.device.lastLocation;
                      if (!loc) return <div>—</div>;

                      const cityText = loc.city
                        ? `${loc.city}${loc.region ? ", " + loc.region : ""}${loc.country ? ", " + loc.country : ""}`
                        : null;

                      const coordsText =
                        typeof loc.lat === "number" && typeof loc.lng === "number"
                          ? `${loc.lat.toFixed(4)}, ${loc.lng.toFixed(4)}`
                          : null;

                      const mapsUrl =
                        typeof loc.lat === "number" && typeof loc.lng === "number"
                          ? `https://www.google.com/maps?q=${loc.lat},${loc.lng}`
                          : null;

                      return (
                        <div className="flex items-center justify-between gap-1">
                          <div>
                            <div className="font-semibold text-gray-900">
                              {cityText || coordsText || "N/A"}
                            </div>
                          </div>

                          {mapsUrl && (
                            <a
                              href={mapsUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="text-blue-600 hover:underline text-sm flex items-center gap-1"
                            >
                              <MapPin size={16} /> Open Map
                            </a>
                          )}
                        </div>
                      );
                    })()}
                  </div>

                  {/* Big “Total Software Used Today” card */}
                  <div className="mt-5 bg-gradient-to-r from-blue-600 to-indigo-600 rounded-2xl p-2 text-white">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <div className="text-sm opacity-90">Total Software Used Today</div>
                        <div className="text-3xl font-bold">
                          {selected.summary?.softwareCount ?? 0}
                        </div>
                      </div>

                      <button
                        onClick={() => openSoftwareTab(selected.device.deviceId)}
                        className="px-4 py-2 rounded-xl bg-white/15 hover:bg-white/25 text-sm font-medium"
                      >
                        View All Software →
                      </button>
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
