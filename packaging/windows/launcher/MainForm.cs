using System;
using System.ComponentModel;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Threading;
using System.Threading.Tasks;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace Seedr
{
    /// <summary>
    /// The Seedr window: a WebView2 showing the dashboard served by the bundled backend.
    /// Closing it stops Seedr, like any other application.
    /// </summary>
    sealed class MainForm : Form
    {
        const int TickMs = 250;
        const int StartupTimeoutMs = 60000;
        const string WebView2Page = "https://developer.microsoft.com/microsoft-edge/webview2/";

        const string Splash =
            "<!doctype html><meta charset=\"utf-8\"><style>" +
            ":root { color-scheme: light dark; }" +
            "body { margin: 0; height: 100vh; display: flex; align-items: center;" +
            " justify-content: center; font: 16px sans-serif; opacity: .6; }" +
            "</style><body>Starting Seedr&hellip;</body>";

        readonly WebView2 view = new WebView2();
        readonly System.Windows.Forms.Timer timer = new System.Windows.Forms.Timer { Interval = TickMs };
        readonly EventWaitHandle showSignal;
        readonly string dataRoot = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Seedr");
        Backend backend;
        RegisteredWaitHandle showWait;
        int waitedMs;
        bool loaded;
        bool closing;

        public MainForm(EventWaitHandle showSignal)
        {
            this.showSignal = showSignal;

            AutoScaleMode = AutoScaleMode.Dpi;
            Text = "Seedr";
            Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath);
            ClientSize = new Size(1200, 800);
            StartPosition = FormStartPosition.CenterScreen;

            view.Dock = DockStyle.Fill;
            Controls.Add(view);
            timer.Tick += OnTick;
        }

        protected override async void OnShown(EventArgs e)
        {
            base.OnShown(e);

            // A second launch signals this instance instead of starting its own engine
            showWait = ThreadPool.RegisterWaitForSingleObject(
                showSignal, (state, timedOut) => BringForward(), null, Timeout.Infinite, false);

            try
            {
                await StartAsync();
            }
            catch (Exception ex)
            {
                Fail("Seedr could not start: " + ex.Message);
            }
        }

        async Task StartAsync()
        {
            if (!WebView2Installed())
            {
                var answer = MessageBox.Show(this,
                    "Seedr needs the Microsoft Edge WebView2 Runtime, which is not installed on this PC." +
                    "\r\n\r\nOpen the download page?",
                    "Seedr", MessageBoxButtons.YesNo, MessageBoxIcon.Warning);
                if (answer == DialogResult.Yes) OpenExternal(WebView2Page);
                Close();
                return;
            }

            backend = new Backend(Path.Combine(dataRoot, "logs", "seedr.log"));
            backend.Start(AppDomain.CurrentDomain.BaseDirectory, Path.Combine(dataRoot, "data"));

            var environment = await CoreWebView2Environment.CreateAsync(null, Path.Combine(dataRoot, "WebView2"));
            await view.EnsureCoreWebView2Async(environment);

            var web = view.CoreWebView2;
            web.Settings.AreDevToolsEnabled = false;
            web.Settings.IsStatusBarEnabled = false;
            web.Settings.IsGeneralAutofillEnabled = false;
            web.Settings.IsPasswordAutosaveEnabled = false;

            // Everything that is not this dashboard (tracker links, target=_blank) goes to the real
            // browser. Only web links: torrent metadata is untrusted and ends up in the UI.
            web.NavigationStarting += (sender, args) =>
            {
                if (IsInternal(args.Uri)) return;
                args.Cancel = true;
                OpenExternal(args.Uri);
            };
            web.NewWindowRequested += (sender, args) =>
            {
                args.Handled = true;
                OpenExternal(args.Uri);
            };

            web.NavigateToString(Splash);
            timer.Start();
        }

        void OnTick(object sender, EventArgs e)
        {
            if (backend.HasExited)
            {
                timer.Stop();
                Fail("Seedr's engine stopped unexpectedly (exit code " + backend.ExitCode + ").");
                return;
            }

            if (loaded) return;

            if (backend.IsListening())
            {
                loaded = true;
                view.CoreWebView2.Navigate(backend.Url);
                return;
            }

            waitedMs += TickMs;
            if (waitedMs > StartupTimeoutMs)
            {
                timer.Stop();
                Fail("Seedr's engine did not start within " + StartupTimeoutMs / 1000 + " seconds.");
            }
        }

        void Fail(string message)
        {
            MessageBox.Show(this,
                message + "\r\n\r\nDetails are in " + (backend != null ? backend.LogPath : dataRoot),
                "Seedr", MessageBoxButtons.OK, MessageBoxIcon.Error);
            Close();
        }

        void BringForward()
        {
            // Runs on a thread-pool thread, possibly while the window is going away
            try
            {
                BeginInvoke(new Action(() =>
                {
                    if (closing) return;
                    if (WindowState == FormWindowState.Minimized) WindowState = FormWindowState.Normal;
                    Activate();
                }));
            }
            catch (InvalidOperationException)
            {
            }
        }

        protected override void OnFormClosing(FormClosingEventArgs e)
        {
            base.OnFormClosing(e);
            if (closing) return;
            closing = true;

            timer.Stop();
            Hide(); // stopping the backend can take a few seconds
            if (backend != null)
            {
                backend.Stop();
                backend.Dispose();
            }
        }

        protected override void OnFormClosed(FormClosedEventArgs e)
        {
            if (showWait != null) showWait.Unregister(null);
            base.OnFormClosed(e);
        }

        static bool WebView2Installed()
        {
            try
            {
                return !string.IsNullOrEmpty(CoreWebView2Environment.GetAvailableBrowserVersionString());
            }
            catch (WebView2RuntimeNotFoundException)
            {
                return false;
            }
        }

        bool IsInternal(string uri)
        {
            if (uri.StartsWith("about:") || uri.StartsWith("data:")) return true; // the splash page
            Uri parsed;
            return Uri.TryCreate(uri, UriKind.Absolute, out parsed)
                && parsed.Scheme == Uri.UriSchemeHttp
                && parsed.Host == "127.0.0.1"
                && parsed.Port == backend.Port;
        }

        static void OpenExternal(string uri)
        {
            Uri parsed;
            if (!Uri.TryCreate(uri, UriKind.Absolute, out parsed)) return;
            if (parsed.Scheme != Uri.UriSchemeHttp && parsed.Scheme != Uri.UriSchemeHttps) return;

            try
            {
                Process.Start(new ProcessStartInfo(parsed.AbsoluteUri) { UseShellExecute = true });
            }
            catch (Win32Exception)
            {
            }
        }
    }
}
