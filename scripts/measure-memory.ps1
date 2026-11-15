# Visual-Agent와 Orca의 메모리 사용량을 같은 방법으로 재서 비교한다 (인수 기준 AC10).
# Visual-Agent는 프로젝트 하나를 연 상태로 새로 띄워 -WaitSeconds 초 뒤에 잰다.
# Orca는 지금 실행 중인 것을 그대로 잰다. Orca 쪽 조건(프로젝트 하나, 에이전트 없음)은 사람이 맞춰 두어야 한다.
# 값은 작업 관리자의 "메모리(개인 작업 집합)"과 같은 항목이다.
# 사용: measure-memory.ps1 [-WaitSeconds 60]
param([int]$WaitSeconds = 60)

$root = Split-Path -Parent $PSScriptRoot
$exe = Join-Path $root "build\dist\Visual-Agent\Visual-Agent.exe"
if (-not (Test-Path $exe)) { throw "build first: npm run build" }

$sandbox = Join-Path ([IO.Path]::GetTempPath()) ("va-mem-" + [Guid]::NewGuid().ToString("N").Substring(0, 8))
$project = Join-Path $sandbox "projects\sample"
$data = Join-Path $sandbox "data"
New-Item -ItemType Directory -Force $project, $data | Out-Null
$state = @{ version = 1; tabs = @(@{ id = "t1"; path = $project }); activeId = "t1"; nextId = 2 } | ConvertTo-Json -Depth 4
[IO.File]::WriteAllText((Join-Path $data "state.json"), $state)

function PrivateWorkingSetMb($processIds) {
    $rows = Get-CimInstance Win32_PerfRawData_PerfProc_Process | Where-Object { $processIds -contains $_.IDProcess }
    [math]::Round((($rows | Measure-Object WorkingSetPrivate -Sum).Sum) / 1MB, 1)
}

$env:VA_DATA_DIR = $data
$app = Start-Process $exe -PassThru
Start-Sleep -Seconds $WaitSeconds

$appIds = @($app.Id) + @(Get-CimInstance Win32_Process | Where-Object { $_.Name -eq "msedgewebview2.exe" -and $_.CommandLine -and $_.CommandLine.Contains($data) } | ForEach-Object { $_.ProcessId })
$appMb = PrivateWorkingSetMb $appIds

$orcaIds = @(Get-Process | Where-Object { $_.ProcessName -match "^orca" } | ForEach-Object { $_.Id })
$orcaMb = if ($orcaIds.Count -gt 0) { PrivateWorkingSetMb $orcaIds } else { $null }

[void]$app.CloseMainWindow()
[void]$app.WaitForExit(15000)
Start-Sleep -Seconds 2
Remove-Item -Recurse -Force $sandbox -ErrorAction SilentlyContinue

"measured at        : " + (Get-Date -Format "yyyy-MM-dd HH:mm:ss")
"wait before measure: $WaitSeconds s"
"Visual-Agent       : $appMb MB  ($($appIds.Count) processes: 1 app + $($appIds.Count - 1) WebView2), 1 project open, no agents"
if ($null -eq $orcaMb) {
    "Orca               : not running"
} else {
    "Orca               : $orcaMb MB  ($($orcaIds.Count) processes named Orca*), state as currently open on this PC"
    "Visual-Agent / Orca: " + [math]::Round($appMb / $orcaMb * 100, 1) + " %"
}
