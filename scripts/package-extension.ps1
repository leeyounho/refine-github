[CmdletBinding()]
param([switch]$SkipTests)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$releaseDir = Join-Path $projectRoot 'release'
$packageFiles = @(
    'manifest.json', 'background.js', 'content.js', 'content.css',
    'popup.html', 'popup.js', 'INSTALL.txt',
    'icons/16.png', 'icons/48.png', 'icons/128.png', 'icons/300.png'
)

Push-Location -LiteralPath $projectRoot
try {
    $task = if ($SkipTests) { 'build' } else { 'verify' }
    & npm.cmd run $task
    if ($LASTEXITCODE -ne 0) { throw "npm run $task failed ($LASTEXITCODE)." }

    $manifest = Get-Content -LiteralPath dist/manifest.json -Raw -Encoding UTF8 | ConvertFrom-Json
    $package = Get-Content -LiteralPath package.json -Raw -Encoding UTF8 | ConvertFrom-Json
    $version = $manifest.version
    if ($version -notmatch '^\d+(\.\d+){0,3}$' -or $version -ne $package.version) {
        throw 'Expected matching numeric extension versions in manifest.json and package.json.'
    }

    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $null = New-Item -ItemType Directory -Path $releaseDir -Force
    $destination = Join-Path $releaseDir "refine-github-$version.zip"
    $temporaryZip = Join-Path $releaseDir ([Guid]::NewGuid().ToString() + '.tmp')
    $archive = [IO.Compression.ZipFile]::Open($temporaryZip, 'Create')
    try {
        foreach ($file in $packageFiles) {
            $source = Join-Path $projectRoot "dist/$file"
            $null = [IO.Compression.ZipFileExtensions]::CreateEntryFromFile($archive, $source, $file)
        }
    } finally {
        $archive.Dispose()
    }

    $archive = [IO.Compression.ZipFile]::OpenRead($temporaryZip)
    try {
        if (Compare-Object $packageFiles @($archive.Entries.FullName)) {
            throw 'ZIP contents differ from the expected release files.'
        }
    } finally {
        $archive.Dispose()
    }
    if ([IO.File]::Exists($destination)) {
        [IO.File]::Replace($temporaryZip, $destination, [System.Management.Automation.Language.NullString]::Value)
    } else {
        [IO.File]::Move($temporaryZip, $destination)
    }
    Write-Host "Created $destination"
} finally {
    if ($temporaryZip -and [IO.File]::Exists($temporaryZip)) {
        Remove-Item -LiteralPath $temporaryZip -Force
    }
    Pop-Location
}
