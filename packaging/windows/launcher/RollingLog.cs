using System;
using System.IO;
using System.Text;

namespace Seedr
{
    /// <summary>
    /// Appends the backend's output to a file and rolls it over at 10 MB, keeping three files.
    /// Seedr is meant to run for months, so the log must not grow without bound.
    /// </summary>
    sealed class RollingLog : IDisposable
    {
        const long MaxBytes = 10L * 1024 * 1024;
        const int Keep = 3;

        readonly string path;
        readonly object gate = new object();
        StreamWriter writer;

        public RollingLog(string path)
        {
            this.path = path;
            Directory.CreateDirectory(Path.GetDirectoryName(path));
            Open();
        }

        public void WriteLine(string line)
        {
            if (line == null) return;
            lock (gate)
            {
                if (writer == null) return;
                try
                {
                    writer.WriteLine(line);
                    if (writer.BaseStream.Length > MaxBytes) Roll();
                }
                catch (IOException)
                {
                    // A log that cannot be written must never take the app down
                }
            }
        }

        void Open()
        {
            var stream = new FileStream(path, FileMode.Append, FileAccess.Write, FileShare.ReadWrite);
            writer = new StreamWriter(stream, new UTF8Encoding(false)) { AutoFlush = true };
        }

        void Roll()
        {
            writer.Dispose();
            writer = null;
            try
            {
                File.Delete(path + "." + (Keep - 1));
                for (int i = Keep - 2; i >= 1; i--)
                {
                    if (File.Exists(path + "." + i)) File.Move(path + "." + i, path + "." + (i + 1));
                }
                File.Move(path, path + ".1");
            }
            catch (IOException)
            {
                // Keep appending to the current file if it cannot be moved
            }
            Open();
        }

        public void Dispose()
        {
            lock (gate)
            {
                if (writer != null) writer.Dispose();
                writer = null;
            }
        }
    }
}
