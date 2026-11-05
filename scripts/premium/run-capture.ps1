# Rebuild the Aetherion scene, build the Windows player, run the scripted tour. Usage: .\run-capture.ps1 -Name run2
param([string]$Name = "run", [switch]$SkipBuild, [string[]]$Extra = @())
$u = Join-Path $PSScriptRoot "..\..\unity" | Resolve-Path
$exe = "C:\Users\user\Unity\Editors\6000.3.28f1\Editor\Unity.exe"
function Unity($method, $log) {
  $p = Start-Process $exe -ArgumentList "-batchmode","-quit","-projectPath","`"$u`"","-executeMethod",$method,"-logFile","`"$u\Logs\$log.log`"" -PassThru -Wait -NoNewWindow
  if ($p.ExitCode -ne 0) { Select-String "$u\Logs\$log.log" -Pattern 'error CS|rror:|Shader error' | Select-Object -First 20 | % { $_.Line }; throw "$method failed ($($p.ExitCode))" }
}
if (-not $SkipBuild) { Unity "GF.EditorTools.AetherionBuilder.BuildAll" "$Name-scene"; Unity "GF.EditorTools.AetherionBuilder.BuildWindows" "$Name-win" }
$shots = "$u\Captures\$Name"; Remove-Item $shots -Recurse -Force -ErrorAction SilentlyContinue
$p = Start-Process "$u\Builds\Win\GalacticFrontier.exe" -ArgumentList (@("-screen-width","1920","-screen-height","1080","-screen-fullscreen","0","-logFile","`"$shots.log`"","-gfcapture","`"$shots`"") + ($Extra -split ",") ) -PassThru
if (-not $p.WaitForExit(300000)) { $p.Kill(); "TIMEOUT" }
Get-Content "$shots\perf.json" -ErrorAction SilentlyContinue
Select-String "$shots.log" -Pattern 'Shader|shader|Exception|NullRef|\[GF\]' | Select-Object -First 12 | % { $_.Line.Trim() }
