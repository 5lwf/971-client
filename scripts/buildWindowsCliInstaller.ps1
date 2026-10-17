param(
    [Parameter(Mandatory = $true)]
    [string]$CliInstallerPath
)

$ErrorActionPreference = "Stop"
$root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$desktopAsar = Join-Path $root "dist\desktop.asar"
$launcherSource = Join-Path $PSScriptRoot "installerLauncher.cs"
$iconSource = Join-Path $root "misc\971ClientInstaller.ico"
$noticesSource = Join-Path $root "misc\INSTALLER_NOTICES.txt"
$outputDir = Join-Path $root "dist\Installer"
$outputPath = Join-Path $outputDir "971 Client Setup.exe"
$expectedCliHash = "BFAAF16E952070825FDABDEEE1DD5A10C3351E7BB69E794268D33F612283101A"

if (-not (Test-Path -LiteralPath $CliInstallerPath -PathType Leaf)) {
    throw "The official Windows CLI installer was not found: $CliInstallerPath"
}
if (-not (Test-Path -LiteralPath $desktopAsar -PathType Leaf)) {
    throw "Build the desktop client first; expected $desktopAsar"
}
if (-not (Test-Path -LiteralPath $iconSource -PathType Leaf)) {
    throw "The 971 Client installer icon was not found: $iconSource"
}

$actualHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $CliInstallerPath).Hash
if ($actualHash -ne $expectedCliHash) {
    throw "The CLI installer does not match the verified official build. Expected $expectedCliHash, got $actualHash."
}

New-Item -ItemType Directory -Path $outputDir -Force | Out-Null
$compiler = "C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe"
if (-not (Test-Path -LiteralPath $compiler -PathType Leaf)) {
    throw "The Windows .NET Framework C# compiler was not found at $compiler"
}

$arguments = @(
    "/nologo",
    "/optimize+",
    "/target:winexe",
    "/platform:x64",
    "/warn:4",
    "/reference:System.dll",
    "/reference:System.Drawing.dll",
    "/reference:System.Windows.Forms.dll",
    "/out:$outputPath",
    "/win32icon:$iconSource",
    "/resource:$((Resolve-Path -LiteralPath $CliInstallerPath).Path),installer-cli.exe",
    "/resource:$desktopAsar,desktop.asar",
    $launcherSource
)
& $compiler @arguments
if ($LASTEXITCODE -ne 0) {
    Remove-Item -LiteralPath $outputPath -Force -ErrorAction SilentlyContinue
    throw "C# compiler exited with code $LASTEXITCODE."
}

Write-Output "Created $outputPath"
Write-Output ("Size: {0:N1} MB" -f ((Get-Item -LiteralPath $outputPath).Length / 1MB))
Copy-Item -LiteralPath $noticesSource -Destination (Join-Path $outputDir "THIRD_PARTY_NOTICES.txt") -Force
