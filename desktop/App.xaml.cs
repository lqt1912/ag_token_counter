using System.Windows;
using System.Runtime.InteropServices;

namespace AntigravityTokenTray;

public partial class App : System.Windows.Application
{
    private TrayIconManager? _tray;

    protected override void OnStartup(StartupEventArgs e)
    {
        base.OnStartup(e);
        var reader = new AntigravityLogReader();

        if (e.Args.Any(arg => string.Equals(arg, "--test", StringComparison.OrdinalIgnoreCase)))
        {
            AttachConsole(-1);
            var snapshot = reader.ReadUsage();
            Console.WriteLine($"Brain: {snapshot.BrainDirectory}");
            Console.WriteLine($"Sessions: {snapshot.SessionCount}");
            Console.WriteLine($"Today: {AntigravityLogReader.FormatNumber(snapshot.Today.TotalTokens)} tokens / {snapshot.Today.RequestCount:N0} requests");
            Console.WriteLine($"All time: {AntigravityLogReader.FormatNumber(snapshot.AllTime.TotalTokens)} tokens / {snapshot.AllTime.RequestCount:N0} requests");
            Shutdown();
            return;
        }

        var window = new MainWindow();
        _tray = new TrayIconManager(window, reader);
        window.RequestRefresh += _tray.Refresh;
        _tray.Refresh();
    }

    protected override void OnExit(ExitEventArgs e)
    {
        _tray?.Dispose();
        base.OnExit(e);
    }

    [DllImport("kernel32.dll")]
    private static extern bool AttachConsole(int processId);
}
