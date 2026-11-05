# Runs the World Editor persistence/regeneration/streaming tests inside Unity (batch mode, real GPU).
$u = Join-Path $PSScriptRoot "..\..\unity" | Resolve-Path
$exe = "C:\Users\user\Unity\Editors\6000.3.28f1\Editor\Unity.exe"
$p = Start-Process $exe -ArgumentList "-batchmode","-projectPath","`"$u`"","-executeMethod","GF.EditorTools.WorldEditorTests.RunAll","-logFile","`"$u\Logs\editor-tests-unity.log`"" -PassThru -Wait -NoNewWindow
"exit=$($p.ExitCode)"
Get-Content "$u\Logs\editor_tests.txt" -ErrorAction SilentlyContinue
if ($p.ExitCode -ne 0) { Select-String "$u\Logs\editor-tests-unity.log" -Pattern 'error CS|Exception|\[GFTEST\]' | Select-Object -First 25 | % { $_.Line.Trim() } }
