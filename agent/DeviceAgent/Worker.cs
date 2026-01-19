using System.Diagnostics;
using System.Management;
using System.Net.Http.Json;
using System.Text.Json.Serialization;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using SocketIOClient;

public class Worker : BackgroundService
{
    private readonly ILogger<Worker> _logger;
    private readonly IHttpClientFactory _httpClientFactory;

    private string? _deviceToken;
    private readonly string _deviceId = Environment.MachineName;

    private const string BackendBaseUrl = "https://managexbackend.onrender.com"; // change for production
    private SocketIOClient.SocketIO? _socket;

    public Worker(ILogger<Worker> logger, IHttpClientFactory httpClientFactory)
    {
        _logger = logger;
        _httpClientFactory = httpClientFactory;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        _logger.LogInformation("Agent started. DeviceId={deviceId}", _deviceId);

        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                if (string.IsNullOrWhiteSpace(_deviceToken))
                {
                    _deviceToken = await RegisterDeviceAsync(stoppingToken);
                    if (string.IsNullOrWhiteSpace(_deviceToken))
                    {
                        _logger.LogWarning("Register failed. Retrying in 30s...");
                        await Task.Delay(TimeSpan.FromSeconds(30), stoppingToken);
                        continue;
                    }
                }

                _ = StartSocketAsync(stoppingToken);

                await Task.WhenAll(
                    HeartbeatLoop(stoppingToken),
                    ProcessTrackingLoop(stoppingToken)
                );
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Fatal loop error. Retrying in 10s...");
                await Task.Delay(TimeSpan.FromSeconds(10), stoppingToken);
            }
        }
    }

    // Create client with correct headers (no duplicates)
    private HttpClient CreateAuthedClient()
    {
        var client = _httpClientFactory.CreateClient();
        client.BaseAddress = new Uri(BackendBaseUrl);

        client.DefaultRequestHeaders.Remove("X-Device-Token");
        if (!string.IsNullOrWhiteSpace(_deviceToken))
        {
            client.DefaultRequestHeaders.Add("X-Device-Token", _deviceToken);
        }

        return client;
    }

    private async Task<string?> RegisterDeviceAsync(CancellationToken ct)
    {
        try
        {
            var client = _httpClientFactory.CreateClient();
            client.BaseAddress = new Uri(BackendBaseUrl);

            var payload = new
            {
                deviceId = _deviceId,
                username = Environment.UserName,
                os = Environment.OSVersion.ToString(),
                model = GetDeviceModel()
            };

            var resp = await client.PostAsJsonAsync("/api/device/register", payload, ct);
            var body = await resp.Content.ReadAsStringAsync(ct);

            if (!resp.IsSuccessStatusCode)
            {
                _logger.LogError("Registration failed. Status={status}. Body={body}",
                    (int)resp.StatusCode, body);
                return null;
            }

            var result = await resp.Content.ReadFromJsonAsync<RegisterResponse>(cancellationToken: ct);
            if (result?.DeviceToken is null)
            {
                _logger.LogError("Registration succeeded but deviceToken missing. RawBody={body}", body);
                return null;
            }

            _logger.LogInformation("Device registered successfully.");
            return result.DeviceToken;
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Registration exception.");
            return null;
        }
    }

    // ✅ Localhost testing: geoip can't resolve 127.0.0.1, so we post a dummy location.
    private async Task SendTestLocationAsync(CancellationToken ct)
    {
        try
        {
            if (string.IsNullOrWhiteSpace(_deviceToken))
            {
                _logger.LogWarning("Test location skipped: device token missing.");
                return;
            }

            var client = CreateAuthedClient();

            // Example: New Delhi coordinates (change to your city if you want)
            var payload = new
            {
                deviceId = _deviceId,
                lat = 28.6139,
                lng = 77.2090,
                accuracyMeters = 500
            };

            var resp = await client.PostAsJsonAsync("/api/device/location", payload, ct);

            if (resp.IsSuccessStatusCode)
            {
                _logger.LogInformation("Test location sent OK ({code})", (int)resp.StatusCode);
            }
            else
            {
                var text = await resp.Content.ReadAsStringAsync(ct);
                _logger.LogWarning("Test location FAILED ({code}). Body={body}", (int)resp.StatusCode, text);
            }
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Test location exception");
        }
    }

    private async Task HeartbeatLoop(CancellationToken ct)
    {
        while (!ct.IsCancellationRequested)
        {
            try
            {
                if (string.IsNullOrWhiteSpace(_deviceToken))
                {
                    _logger.LogWarning("Heartbeat skipped: device token is missing (not registered).");
                }
                else
                {
                    var client = CreateAuthedClient();

                    var resp = await client.PostAsJsonAsync("/api/device/heartbeat",
                        new { deviceId = _deviceId }, ct);

                    if (resp.IsSuccessStatusCode)
                    {
                        _logger.LogInformation("Heartbeat OK ({code})", (int)resp.StatusCode);
                    }
                    else
                    {
                        var text = await resp.Content.ReadAsStringAsync(ct);
                        _logger.LogWarning("Heartbeat FAILED ({code}). Body={body}", (int)resp.StatusCode, text);
                    }
                }
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "Heartbeat exception");
            }

            await Task.Delay(TimeSpan.FromSeconds(30), ct);
        }
    }

    private async Task ProcessTrackingLoop(CancellationToken ct)
    {
        while (!ct.IsCancellationRequested)
        {
            try
            {
                if (string.IsNullOrWhiteSpace(_deviceToken))
                {
                    _logger.LogWarning("Process snapshot skipped: device token is missing (not registered).");
                }
                else
                {
                    var processes = Process.GetProcesses()
                        .Select(p => p.ProcessName.ToLowerInvariant())
                        .Distinct()
                        .ToList();

                    await SendProcessSnapshotAsync(processes, ct);
                }
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "Process tracking exception");
            }

            await Task.Delay(TimeSpan.FromSeconds(15), ct);
        }
    }

    private async Task SendProcessSnapshotAsync(List<string> processNames, CancellationToken ct)
    {
        try
        {
            var client = CreateAuthedClient();

            var payload = new
            {
                deviceId = _deviceId,
                processes = processNames
            };

            var resp = await client.PostAsJsonAsync("/api/usage/process-snapshot", payload, ct);

            if (resp.IsSuccessStatusCode)
            {
                _logger.LogInformation("Sent snapshot OK. Count={count} ({code})",
                    processNames.Count, (int)resp.StatusCode);
            }
            else
            {
                var text = await resp.Content.ReadAsStringAsync(ct);
                _logger.LogWarning("Snapshot FAILED ({code}). Body={body}", (int)resp.StatusCode, text);
            }
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Send snapshot exception");
        }
    }

    private async Task StartSocketAsync(CancellationToken ct)
    {
        try
        {
            _socket = new SocketIOClient.SocketIO(BackendBaseUrl, new SocketIOOptions
            {
                Reconnection = true
            });

            _socket.OnConnected += async (_, __) =>
            {
                _logger.LogInformation("Socket connected. Joining device room...");
                await _socket.EmitAsync("join-device", new { deviceId = _deviceId });
            };

            _socket.On("command", response =>
            {
                var cmd = response.GetValue<CommandPayload>();
                _logger.LogInformation("Command received: {cmd}", cmd.Command);

                if (cmd.Command == "LOCK") LockDevice(cmd.Message);
                if (cmd.Command == "UNLOCK") UnlockDevice();
            });

            await _socket.ConnectAsync();
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Socket failed");
        }
    }

    private void LockDevice(string? message)
    {
        _logger.LogWarning("LOCK requested. Message: {msg}", message ?? "");

        if (!OperatingSystem.IsWindows())
        {
            _logger.LogWarning("LockWorkStation is Windows-only.");
            return;
        }

        Process.Start(new ProcessStartInfo("rundll32.exe", "user32.dll,LockWorkStation")
        {
            CreateNoWindow = true,
            UseShellExecute = false
        });
    }

    private void UnlockDevice()
    {
        _logger.LogWarning("UNLOCK requested (Phase-2 will close lock overlay).");
    }

    private static string GetDeviceModel()
    {
        if (!OperatingSystem.IsWindows()) return "Unknown";

        try
        {
            using var searcher = new ManagementObjectSearcher("SELECT * FROM Win32_ComputerSystem");
            foreach (var obj in searcher.Get())
                return obj["Model"]?.ToString() ?? "Unknown";
        }
        catch { }

        return "Unknown";
    }

    private class RegisterResponse
    {
        [JsonPropertyName("deviceToken")]
        public string? DeviceToken { get; set; }
    }

    private class CommandPayload
    {
        [JsonPropertyName("command")]
        public string Command { get; set; } = "";

        [JsonPropertyName("message")]
        public string? Message { get; set; }
    }
}
