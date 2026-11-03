using System;
using System.Diagnostics;
using System.IO;
using System.Net;
using System.Net.Sockets;
using System.Text;
using System.Text.RegularExpressions;

namespace Seedr
{
    /// <summary>The bundled Node.js backend: a child process serving the dashboard on a loopback port.</summary>
    sealed class Backend : IDisposable
    {
        const int DefaultWebPort = 8080;
        const int StopTimeoutMs = 20000; // the engine sends its "stopped" announces within 10 s

        readonly RollingLog log;
        readonly JobObject job = new JobObject();
        Process process;

        public Backend(string logPath)
        {
            LogPath = logPath;
            log = new RollingLog(logPath);
            Port = PickWebPort();
        }

        public int Port { get; private set; }
        public string Url { get { return "http://127.0.0.1:" + Port + "/"; } }
        public string LogPath { get; private set; }
        public bool HasExited { get { return process.HasExited; } }
        public int ExitCode { get { return process.ExitCode; } }

        // The UI is private to this window; 8080 is kept when free so it stays
        // reachable from a browser too, any free port otherwise.
        static int PickWebPort()
        {
            int preferred;
            if (!int.TryParse(Environment.GetEnvironmentVariable("WEB_PORT"), out preferred))
                preferred = DefaultWebPort;

            foreach (int candidate in new[] { preferred, 0 })
            {
                var probe = new TcpListener(IPAddress.Loopback, candidate);
                try
                {
                    probe.Start();
                    return ((IPEndPoint)probe.LocalEndpoint).Port;
                }
                catch (SocketException)
                {
                }
                finally
                {
                    probe.Stop();
                }
            }
            throw new IOException("No free TCP port on 127.0.0.1");
        }

        public void Start(string appDir, string dataDir)
        {
            var start = new ProcessStartInfo(Path.Combine(appDir, "node.exe"), "dist\\index.js")
            {
                WorkingDirectory = appDir,
                UseShellExecute = false,
                CreateNoWindow = true,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                StandardOutputEncoding = Encoding.UTF8,
                StandardErrorEncoding = Encoding.UTF8,
            };

            var env = start.EnvironmentVariables;
            // Basic Auth would lock the embedded window out, and Windows always sets USERNAME
            env.Remove("USERNAME");
            env.Remove("PASSWORD");
            env["NODE_ENV"] = "production";
            env["HOST"] = "127.0.0.1";
            env["WEB_PORT"] = Port.ToString();
            if (!env.ContainsKey("DATA_DIR")) env["DATA_DIR"] = dataDir;

            process = Process.Start(start);
            job.Add(process);
            process.OutputDataReceived += (sender, e) => log.WriteLine(e.Data);
            process.ErrorDataReceived += (sender, e) => log.WriteLine(e.Data);
            process.BeginOutputReadLine();
            process.BeginErrorReadLine();
        }

        public bool IsListening()
        {
            try
            {
                using (var client = new TcpClient())
                {
                    var pending = client.BeginConnect("127.0.0.1", Port, null, null);
                    return pending.AsyncWaitHandle.WaitOne(200) && client.Connected;
                }
            }
            catch (SocketException)
            {
                return false;
            }
        }

        string Control(string action, string method, int timeoutMs)
        {
            var request = (HttpWebRequest)WebRequest.Create(Url + "api/control/" + action);
            request.Method = method;
            if (method == "POST") request.ContentLength = 0;
            request.Proxy = null; // 127.0.0.1 must not go through a proxy configured for Windows
            request.Timeout = timeoutMs;
            using (var response = request.GetResponse())
            using (var reader = new StreamReader(response.GetResponseStream(), Encoding.UTF8))
            {
                return reader.ReadToEnd();
            }
        }

        /// <summary>Whether the engine is seeding, null while the backend cannot be reached.</summary>
        public bool? IsEngineRunning()
        {
            try
            {
                // "running" is the first key of the status object, ahead of anything the torrents add
                var match = Regex.Match(Control("status", "GET", 2000), "\"running\"\\s*:\\s*(true|false)");
                return match.Success ? (bool?)(match.Groups[1].Value == "true") : null;
            }
            catch (WebException)
            {
                return null;
            }
        }

        /// <summary>Starts or stops the announces without ending the process.</summary>
        public void SetEngineRunning(bool running)
        {
            Control(running ? "start" : "stop", "POST", StopTimeoutMs);
        }

        public void Stop()
        {
            if (process == null || process.HasExited) return;

            // Windows has no way to ask node to shut down, but the API's stop endpoint does what a
            // shutdown signal would: it sends the trackers their "stopped" announces and saves the state.
            try
            {
                Control("stop", "POST", StopTimeoutMs);
            }
            catch (WebException)
            {
                // Nothing to wait for: it is terminated below either way
            }

            try
            {
                if (!process.HasExited) process.Kill();
                process.WaitForExit(5000);
            }
            catch (InvalidOperationException)
            {
            }
            catch (System.ComponentModel.Win32Exception)
            {
            }
        }

        public void Dispose()
        {
            if (process != null) process.Dispose();
            job.Dispose();
            log.Dispose();
        }
    }
}
