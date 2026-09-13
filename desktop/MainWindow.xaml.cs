using System.Diagnostics;
using System.IO;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;
using AntigravityTokenTray.Models;
using MediaColor = System.Windows.Media.Color;
using WpfProgressBar = System.Windows.Controls.ProgressBar;

namespace AntigravityTokenTray;

public partial class MainWindow : Window
{
    public event Action? RequestRefresh;
    public MainWindow() => InitializeComponent();

    public void PositionNearTray()
    {
        var area = SystemParameters.WorkArea;
        Left = area.Right - Width - 10;
        Top = area.Bottom - Height - 10;
    }

    public void UpdateData(UsageSnapshot snapshot)
    {
        Dispatcher.Invoke(() =>
        {
            var current = snapshot.CurrentSession;
            TxtSession.Text = current == null ? "No transcript found" : current.Title;
            TxtSessionDetail.Text = current == null ? snapshot.BrainDirectory : $"{current.Model} · {FormatCompact(current.Usage.TotalTokens)} estimated tokens";
            TxtHeroTotal.Text = current == null ? "0" : FormatCompact(current.Usage.TotalTokens);
            TxtToday.Text = FormatCompact(snapshot.Today.TotalTokens);
            TxtTodayDetail.Text = $"{AntigravityLogReader.FormatNumber(snapshot.Today.RequestCount)} requests";
            TxtAllTime.Text = FormatCompact(snapshot.AllTime.TotalTokens);
            TxtSessions.Text = $"{snapshot.SessionCount:N0} sessions";
            TxtModel.Text = current?.Model ?? "--";
            TxtRequests.Text = $"{current?.Usage.RequestCount ?? 0:N0} requests";
            TxtUpdated.Text = $"Updated {snapshot.Timestamp:HH:mm:ss}";

            PanelModels.Children.Clear();
            var maxTotal = snapshot.AllTimeByModel.Count == 0 ? 1d : snapshot.AllTimeByModel.Max(model => (double)model.TotalTokens);
            foreach (var model in snapshot.AllTimeByModel)
            {
                var wrap = new StackPanel { Margin = new Thickness(0, 0, 0, 12) };
                var row = new Grid();
                row.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(10) });
                row.ColumnDefinitions.Add(new ColumnDefinition());
                row.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
                var dot = new Border { Width = 8, Height = 8, CornerRadius = new CornerRadius(4), Background = new SolidColorBrush(ColorForModel(model.Model)), VerticalAlignment = VerticalAlignment.Center };
                Grid.SetColumn(dot, 0);
                var name = new TextBlock { Text = model.Model, FontSize = 12, FontWeight = FontWeights.SemiBold, Foreground = new SolidColorBrush(MediaColor.FromRgb(51, 65, 85)), TextTrimming = TextTrimming.CharacterEllipsis, Margin = new Thickness(8, 0, 8, 0) };
                Grid.SetColumn(name, 1);
                var value = new TextBlock { Text = FormatCompact(model.TotalTokens), FontSize = 12, FontWeight = FontWeights.Bold, Foreground = new SolidColorBrush(MediaColor.FromRgb(15, 23, 42)), HorizontalAlignment = System.Windows.HorizontalAlignment.Right };
                Grid.SetColumn(value, 2);
                row.Children.Add(dot); row.Children.Add(name); row.Children.Add(value);
                wrap.Children.Add(row);
                var progress = new WpfProgressBar { Height = 4, Minimum = 0, Maximum = 1, Value = Math.Min(1, model.TotalTokens / maxTotal), Foreground = new SolidColorBrush(ColorForModel(model.Model)), Background = new SolidColorBrush(MediaColor.FromRgb(226, 232, 240)), BorderThickness = new Thickness(0), Margin = new Thickness(18, 5, 0, 4) };
                wrap.Children.Add(progress);
                var detail = new TextBlock { Text = $"In {AntigravityLogReader.FormatNumber(model.InputTokens)}  ·  Out {AntigravityLogReader.FormatNumber(model.OutputTokens)}  ·  {model.RequestCount:N0} req", FontSize = 10, Foreground = new SolidColorBrush(MediaColor.FromRgb(100, 116, 139)), Margin = new Thickness(18, 0, 0, 0) };
                wrap.Children.Add(detail);
                PanelModels.Children.Add(wrap);
            }
        });
    }

    private static string FormatCompact(long value)
    {
        if (value >= 1_000_000_000) return $"{value / 1_000_000_000d:0.##}B";
        if (value >= 1_000_000) return $"{value / 1_000_000d:0.##}M";
        if (value >= 1_000) return $"{value / 1_000d:0.##}K";
        return value.ToString("N0");
    }

    private static MediaColor ColorForModel(string model)
    {
        var name = model.ToLowerInvariant();
        if (name.Contains("claude")) return MediaColor.FromRgb(217, 119, 6);
        if (name.Contains("gemini 3.8") || name.Contains("gemini-3.8")) return MediaColor.FromRgb(8, 145, 178);
        if (name.Contains("gemini 3.7") || name.Contains("gemini-3.7")) return MediaColor.FromRgb(37, 99, 235);
        return MediaColor.FromRgb(16, 185, 129);
    }

    private void CloseBtn_Click(object sender, RoutedEventArgs e) => Hide();
    private void Window_Deactivated(object? sender, EventArgs e) => Hide();
    private void RefreshBtn_Click(object sender, RoutedEventArgs e) => RequestRefresh?.Invoke();
    private void LogsBtn_Click(object sender, RoutedEventArgs e)
    {
        var path = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), ".gemini", "antigravity-ide", "brain");
        if (Directory.Exists(path)) Process.Start(new ProcessStartInfo { FileName = path, UseShellExecute = true });
    }
}
