# Build the spherical Aetherion scene + Windows player and run the automated planet tests/screenshots.
# Usage: .\run-planet.ps1 -Name p1 [-SkipBuild]
param([string]$Name = "planet", [switch]$SkipBuild)
$u = Join-Path $PSScriptRoot "..\..\unity" | Resolve-Path
$exe = "C:\Users\user\Unity\Editors\6000.3.28f1\Editor\Unity.exe"
function Unity($method, $log) {
  $p = Start-Process $exe -ArgumentList "-batchmode","-quit","-projectPath","`"$u`"","-executeMethod",$method,"-logFile","`"$u\Logs\$log.log`"" -PassThru -Wait -NoNewWindow
  if ($p.ExitCode -ne 0) { Select-String "$u\Logs\$log.log" -Pattern 'error CS|rror:|Shader error|Exception' | Select-Object -First 25 | % { $_.Line }; throw "$method failed ($($p.ExitCode))" }
}
if (-not $SkipBuild) { Unity "GF.EditorTools.PlanetSceneBuilder.BuildAll" "$Name-scene"; Unity "GF.EditorTools.PlanetSceneBuilder.BuildWindows" "$Name-win" }
$shots = "$u\Captures\$Name"; Remove-Item $shots -Recurse -Force -ErrorAction SilentlyContinue
$p = Start-Process "$u\Builds\WinPlanet\GalacticFrontierPlanet.exe" -ArgumentList "-screen-width","1920","-screen-height","1080","-screen-fullscreen","0","-logFile","`"$shots.log`"","-gfplanet","`"$shots`"" -PassThru
if (-not $p.WaitForExit(600000)) { $p.Kill(); "TIMEOUT" }
Get-Content "$shots\planet_tests.json" -ErrorAction SilentlyContinue
Select-String "$shots.log" -Pattern 'Exception|NullRef|Shader error|\[GF\]' | Select-Object -First 15 | % { $_.Line.Trim() }
