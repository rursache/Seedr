; Inno Setup script for Seedr.
; Build with:  ISCC.exe /DMyAppVersion=1.2.3 /DStageDir=<path to build\stage\win-x64\seedr> packaging\windows\seedr.iss

#ifndef MyAppVersion
  #define MyAppVersion "0.0.0"
#endif
#ifndef StageDir
  #define StageDir "..\..\build\stage\win-x64\seedr"
#endif

#define MyAppName "Seedr"
#define MyAppURL  "https://github.com/rursache/Seedr"
#define Svc       "{app}\seedr-service.exe"

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
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
PrivilegesRequired=admin
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
UninstallDisplayName={#MyAppName}

[Dirs]
; Seedr does not create DATA_DIR itself, so the installer must
Name: "{commonappdata}\Seedr\data"
Name: "{commonappdata}\Seedr\logs"

[Files]
Source: "{#StageDir}\*"; DestDir: "{app}"; Flags: recursesubdirs createallsubdirs ignoreversion
; Settings file: created once, never overwritten on upgrade, kept on uninstall
Source: "seedr.env"; DestDir: "{commonappdata}\Seedr"; Flags: onlyifdoesntexist uninsneveruninstall

[INI]
Filename: "{app}\Seedr.url"; Section: "InternetShortcut"; Key: "URL"; String: "http://localhost:8080"

[Icons]
Name: "{autoprograms}\Seedr Web UI"; Filename: "{app}\Seedr.url"

[Run]
; Allow inbound BitTorrent connections for node.exe, whichever port is configured
Filename: "{sys}\netsh.exe"; Parameters: "advfirewall firewall add rule name=""Seedr"" dir=in action=allow program=""{app}\node.exe"" enable=yes profile=any"; Flags: runhidden waituntilterminated
Filename: "{#Svc}"; Parameters: "install"; Flags: runhidden waituntilterminated
Filename: "{#Svc}"; Parameters: "start"; Flags: runhidden waituntilterminated
Filename: "{app}\Seedr.url"; Description: "Open the Seedr web UI"; Flags: shellexec postinstall skipifsilent nowait

[UninstallRun]
Filename: "{#Svc}"; Parameters: "stop"; Flags: runhidden waituntilterminated; RunOnceId: "StopSvc"
Filename: "{#Svc}"; Parameters: "uninstall"; Flags: runhidden waituntilterminated; RunOnceId: "RemoveSvc"
Filename: "{sys}\netsh.exe"; Parameters: "advfirewall firewall delete rule name=""Seedr"""; Flags: runhidden waituntilterminated; RunOnceId: "RemoveFirewall"

[Code]
// On upgrade: stop and unregister the running service so its files can be replaced.
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
