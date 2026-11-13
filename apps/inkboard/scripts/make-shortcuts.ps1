param([string]$AppDir)
$AppDir = $AppDir.TrimEnd('\')
$exe = Join-Path $AppDir 'node_modules\electron\dist\electron.exe'
$ico = Join-Path $AppDir 'build\icon.ico'
$shell = New-Object -ComObject WScript.Shell
$targets = @(
  (Join-Path ([Environment]::GetFolderPath('Desktop')) 'Inkboard.lnk'),
  (Join-Path ([Environment]::GetFolderPath('Programs')) 'Inkboard.lnk')
)
foreach ($t in $targets) {
  $s = $shell.CreateShortcut($t)
  $s.TargetPath = $exe
  $s.Arguments = '"' + $AppDir + '"'
  $s.WorkingDirectory = $AppDir
  $s.IconLocation = $ico
  $s.Description = 'Inkboard whiteboard and notebook'
  $s.Save()
}
# Open .inkb files with Inkboard (current user only, no admin needed)
$cmd = '"' + $exe + '" "' + $AppDir + '" "%1"'
New-Item -Path 'HKCU:\Software\Classes\.inkb' -Force | Out-Null
Set-ItemProperty -Path 'HKCU:\Software\Classes\.inkb' -Name '(default)' -Value 'Inkboard.Notebook'
New-Item -Path 'HKCU:\Software\Classes\Inkboard.Notebook\DefaultIcon' -Force | Out-Null
Set-ItemProperty -Path 'HKCU:\Software\Classes\Inkboard.Notebook' -Name '(default)' -Value 'Inkboard notebook'
Set-ItemProperty -Path 'HKCU:\Software\Classes\Inkboard.Notebook\DefaultIcon' -Name '(default)' -Value $ico
New-Item -Path 'HKCU:\Software\Classes\Inkboard.Notebook\shell\open\command' -Force | Out-Null
Set-ItemProperty -Path 'HKCU:\Software\Classes\Inkboard.Notebook\shell\open\command' -Name '(default)' -Value $cmd
Write-Host ' Shortcuts created.'
