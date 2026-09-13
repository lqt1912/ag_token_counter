# Antigravity Token Tray

Standalone .NET 10 WPF tray app for local Antigravity transcript usage.

It reads:

`%USERPROFILE%\.gemini\antigravity-ide\brain\<conversation-id>\.system_generated\logs\transcript.jsonl`

The app shows current-session, today, all-time, and model breakdowns. Its processed-token number is an estimate based on replaying visible context before each `PLANNER_RESPONSE`; the provider's exact usage is not present in the transcript files.

## Build

```powershell
dotnet build AntigravityTokenTray.csproj -c Release
dotnet publish AntigravityTokenTray.csproj -c Release -r win-x64 --self-contained true -p:PublishSingleFile=true -p:IncludeNativeLibrariesForSelfExtract=true -o publish
```

The standalone executable is `publish\AntigravityTokenTray.exe`.

To smoke-test the reader without opening the tray window:

```powershell
.\publish\AntigravityTokenTray.exe --test
```
