; Inno Setup script for Seedr.
; Build with:  ISCC.exe /DMyAppVersion=1.2.3 [/DStageDir=<build\stage\win-x64\seedr>] [/DLauncherDir=<build\launcher>] packaging\windows\seedr.iss
; It packs the app tree made by packaging/stage.sh and the desktop launcher published from packaging\windows\launcher.

#ifndef MyAppVersion
  #define MyAppVersion "0.0.0"
#endif
#ifndef StageDir
  #define StageDir "..\..\build\stage\win-x64\seedr"
#endif
#ifndef LauncherDir
  #define LauncherDir "..\..\build\launcher"
#endif

#define MyAppName "Seedr"
#define MyAppURL  "https://github.com/rursache/Seedr"
#define MyAppExe  "Seedr.exe"

[Setup]
AppId={{684DA94C-7D8F-4D6E-97B3-286F8DC171A9}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher=Seedr
AppPublisherURL={#MyAppURL}
AppSupportURL={#MyAppURL}
DefaultDirName={autopf}\{#MyAppName}
DefaultGroupName={#MyAppName}
DisableProgramGroupPage=yes
LicenseFile=..\..\LICENSE
OutputDir=..\..\build\out
OutputBaseFilename=Seedr-Setup-{#MyAppVersion}-x64
SetupIconFile=seedr.ico
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
PrivilegesRequired=admin
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
UninstallDisplayName={#MyAppName}
UninstallDisplayIcon={app}\{#MyAppExe}
; Held by the launcher: setup and uninstall ask for a running Seedr to be closed first
AppMutex=Seedr.SingleInstance

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"; Flags: unchecked

[Files]
Source: "{#StageDir}\*"; DestDir: "{app}"; Flags: recursesubdirs createallsubdirs ignoreversion
Source: "{#LauncherDir}\*"; DestDir: "{app}"; Excludes: "*.pdb"; Flags: recursesubdirs createallsubdirs ignoreversion

[InstallDelete]
; Left behind by the versions that ran Seedr as a Windows service
Type: files; Name: "{app}\seedr-service.exe"
Type: files; Name: "{app}\seedr-service.xml"
Type: files; Name: "{app}\Seedr.url"
Type: files; Name: "{autoprograms}\Seedr Web UI.lnk"

[Icons]
Name: "{autoprograms}\{#MyAppName}"; Filename: "{app}\{#MyAppExe}"
Name: "{autodesktop}\{#MyAppName}"; Filename: "{app}\{#MyAppExe}"; Tasks: desktopicon

[Run]
; Allow inbound BitTorrent connections for node.exe, whichever port is configured
Filename: "{sys}\netsh.exe"; Parameters: "advfirewall firewall delete rule name=""Seedr"""; Flags: runhidden waituntilterminated
Filename: "{sys}\netsh.exe"; Parameters: "advfirewall firewall add rule name=""Seedr"" dir=in action=allow program=""{app}\node.exe"" enable=yes profile=any"; Flags: runhidden waituntilterminated
; Setup runs elevated: the app must start as the user who ran it, with that user's data folder
Filename: "{app}\{#MyAppExe}"; Description: "{cm:LaunchProgram,{#MyAppName}}"; Flags: nowait postinstall skipifsilent runasoriginaluser

[UninstallRun]
Filename: "{sys}\netsh.exe"; Parameters: "advfirewall firewall delete rule name=""Seedr"""; Flags: runhidden waituntilterminated; RunOnceId: "RemoveFirewall"

[Code]
// Upgrading from a version that ran Seedr as a Windows service: stop and unregister
// it, or it would keep the BitTorrent port from the app. Its data stays in
// C:\ProgramData\Seedr, where the app does not look any more.
function PrepareToInstall(var NeedsRestart: Boolean): String;
var
  ResultCode: Integer;
  SvcExe: String;
begin
  SvcExe := ExpandConstant('{app}\seedr-service.exe');
  if FileExists(SvcExe) then
  begin
    Exec(SvcExe, 'stop', '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
    Exec(SvcExe, 'uninstall', '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
  end;
  Result := '';
end;
