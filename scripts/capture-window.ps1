# 앱 창을 그림 파일로 저장한다. 창이 다른 창에 가려져 있어도 된다.
# 사용: capture-window.ps1 -ProcessId <pid> -Out <png 경로>
param(
    [Parameter(Mandatory = $true)][int]$ProcessId,
    [Parameter(Mandatory = $true)][string]$Out
)

Add-Type -AssemblyName System.Drawing
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class VaCapture {
    [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
    [DllImport("user32.dll")] public static extern bool GetClientRect(IntPtr hwnd, out RECT rect);
    [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr hwnd, IntPtr hdc, uint flags);
    [DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(IntPtr value);
}
'@
[void][VaCapture]::SetProcessDpiAwarenessContext([IntPtr](-4))

$process = Get-Process -Id $ProcessId -ErrorAction Stop
$hwnd = $process.MainWindowHandle
if ($hwnd -eq [IntPtr]::Zero) { throw "프로세스 $ProcessId 의 창을 찾을 수 없습니다." }

$rect = New-Object VaCapture+RECT
[void][VaCapture]::GetClientRect($hwnd, [ref]$rect)
$width = $rect.Right - $rect.Left
$height = $rect.Bottom - $rect.Top
if ($width -le 0 -or $height -le 0) { throw "창 크기가 0입니다 (최소화되어 있을 수 있습니다)." }

$bitmap = New-Object System.Drawing.Bitmap $width, $height
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$hdc = $graphics.GetHdc()
# 1 = 창 틀을 뺀 안쪽만, 2 = 화면 부품(WebView2)이 그린 내용까지 포함
$ok = [VaCapture]::PrintWindow($hwnd, $hdc, 3)
$graphics.ReleaseHdc($hdc)
$graphics.Dispose()
if (-not $ok) { throw "창을 캡처하지 못했습니다." }

$directory = Split-Path -Parent $Out
if ($directory -and -not (Test-Path $directory)) { New-Item -ItemType Directory -Force $directory | Out-Null }
$bitmap.Save($Out, [System.Drawing.Imaging.ImageFormat]::Png)
$bitmap.Dispose()
"$Out ($width x $height)"
