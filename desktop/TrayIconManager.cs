using System.Drawing;
using System.Drawing.Drawing2D;
using System.IO;
using System.Windows.Forms;
using AntigravityTokenTray.Models;
using Application = System.Windows.Application;

namespace AntigravityTokenTray;

public sealed class TrayIconManager : IDisposable
{
    private readonly NotifyIcon _icon;
    private readonly MainWindow _window;
    private readonly AntigravityLogReader _reader;
    private readonly System.Windows.Forms.Timer _timer;
    private FileSystemWatcher? _watcher;
    private System.Windows.Forms.Timer? _debounce;

    public TrayIconManager(MainWindow window, AntigravityLogReader reader)
    {
        _window = window; _reader = reader;
        _icon = new NotifyIcon { Visible = true, Text = "Antigravity Tokens", Icon = CreateIcon() };
        var menu = new ContextMenuStrip();
        menu.Items.Add(new ToolStripMenuItem("📊 Show Details", null, (_, _) => ShowWindow()));
        menu.Items.Add(new ToolStripMenuItem("🔄 Refresh Now", null, (_, _) => Refresh()));
        menu.Items.Add(new ToolStripSeparator());
        menu.Items.Add(new ToolStripMenuItem("📂 Open Brain Folder", null, (_, _) => OpenFolder()));
        menu.Items.Add(new ToolStripMenuItem("❌ Exit", null, (_, _) => Application.Current.Shutdown()));
        _icon.ContextMenuStrip = menu;
        _icon.MouseClick += (_, e) => { if (e.Button == MouseButtons.Left) ToggleWindow(); };
        _timer = new System.Windows.Forms.Timer { Interval = 30000 }; _timer.Tick += (_, _) => Refresh(); _timer.Start();
        SetupWatcher();
    }

    public void Refresh()
    {
        try
        {
            var snapshot = _reader.ReadUsage();
            _window.UpdateData(snapshot);
            _icon.Text = snapshot.CurrentSession == null ? "Antigravity Tokens: idle" : $"Antigravity: {FormatCompact(snapshot.Today.TotalTokens)} today";
        }
        catch { }
    }

    private void SetupWatcher()
    {
        try
        {
            var dir = _reader.GetBrainDirectory(); if (dir == null) return;
            _watcher = new FileSystemWatcher(dir) { IncludeSubdirectories = true, NotifyFilter = NotifyFilters.LastWrite | NotifyFilters.Size | NotifyFilters.FileName };
            _debounce = new System.Windows.Forms.Timer { Interval = 500 }; _debounce.Tick += (_, _) => { _debounce.Stop(); Refresh(); };
            _watcher.Changed += (_, _) => Debounce(); _watcher.Created += (_, _) => Debounce(); _watcher.EnableRaisingEvents = true;
        }
        catch { }
    }
    private void Debounce() { if (_debounce == null) return; _debounce.Stop(); _debounce.Start(); }
    private void ToggleWindow() { if (_window.IsVisible) _window.Hide(); else ShowWindow(); }
    private void ShowWindow() { _window.PositionNearTray(); _window.Show(); _window.Activate(); }
    private void OpenFolder() { var path = _reader.GetBrainDirectory(); if (path != null) System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo { FileName = path, UseShellExecute = true }); }
    private static string FormatCompact(long value) => value >= 1_000_000 ? $"{value / 1_000_000d:0.#}M" : value >= 1_000 ? $"{value / 1_000d:0.#}K" : value.ToString();
    private static Icon CreateIcon()
    {
        using var bitmap = new Bitmap(32, 32); using var graphics = Graphics.FromImage(bitmap); graphics.SmoothingMode = SmoothingMode.AntiAlias; graphics.Clear(Color.Transparent);
        using var brush = new SolidBrush(Color.FromArgb(16, 185, 129)); graphics.FillEllipse(brush, 4, 4, 24, 24);
        using var pen = new Pen(Color.White, 3); graphics.DrawArc(pen, 9, 9, 14, 14, -60, 230);
        return Icon.FromHandle(bitmap.GetHicon());
    }
    public void Dispose() { _timer.Stop(); _timer.Dispose(); _debounce?.Dispose(); _watcher?.Dispose(); _icon.Visible = false; _icon.Dispose(); }
}
