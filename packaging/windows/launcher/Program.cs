using System;
using System.Threading;
using System.Windows.Forms;

namespace Seedr
{
    static class Program
    {
        // The installer's AppMutex names the same mutex, so setup asks for a running Seedr to be closed
        const string MutexName = "Seedr.SingleInstance";
        const string ShowEventName = "Seedr.ShowWindow";

        [STAThread]
        static void Main()
        {
            bool first;
            using (var mutex = new Mutex(true, MutexName, out first))
            {
                if (!first)
                {
                    // Already running: bring its window forward instead of starting a second engine
                    try
                    {
                        using (var show = EventWaitHandle.OpenExisting(ShowEventName)) show.Set();
                    }
                    catch (WaitHandleCannotBeOpenedException)
                    {
                    }
                    return;
                }

                Application.EnableVisualStyles();
                Application.SetCompatibleTextRenderingDefault(false);
                using (var show = new EventWaitHandle(false, EventResetMode.AutoReset, ShowEventName))
                {
                    Application.Run(new MainForm(show));
                }
                mutex.ReleaseMutex();
            }
        }
    }
}
