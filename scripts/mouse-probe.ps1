# 실제 마우스 입력으로 앱 창을 끌거나 더블클릭한다. 커서가 1~2초 동안 움직이고, 끝나면 원래 자리로 돌아온다.
# 누르기 전에 커서 아래가 이 앱의 창인지 확인하고, 아니면 아무것도 누르지 않고 멈춘다.
# 사용: mouse-probe.ps1 -ProcessId <pid> -Action drag|doubleclick -X n -Y n [-DX n -DY n]   (화면 좌표)
param(
    [Parameter(Mandatory = $true)][int]$ProcessId,
    [Parameter(Mandatory = $true)][ValidateSet("drag", "doubleclick")][string]$Action,
    [Parameter(Mandatory = $true)][int]$X,
    [Parameter(Mandatory = $true)][int]$Y,
    [int]$DX = 0,
    [int]$DY = 0
)

Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class VaMouse {
    [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X, Y; }
    [DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(IntPtr value);
    [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
    [DllImport("user32.dll")] public static extern bool GetCursorPos(out POINT point);
    [DllImport("user32.dll")] public static extern void mouse_event(uint flags, uint dx, uint dy, uint data, UIntPtr extra);
    [DllImport("user32.dll")] public static extern IntPtr WindowFromPoint(POINT point);
    [DllImport("user32.dll")] public static extern IntPtr GetAncestor(IntPtr hwnd, uint flags);
    [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr hwnd, IntPtr after, int x, int y, int cx, int cy, uint flags);
}
'@
[void][VaMouse]::SetProcessDpiAwarenessContext([IntPtr](-4))

$hwnd = (Get-Process -Id $ProcessId -ErrorAction Stop).MainWindowHandle
if ($hwnd -eq [IntPtr]::Zero) { throw "window not found for process $ProcessId" }

$LEFTDOWN = 0x0002; $LEFTUP = 0x0004
$NOMOVE_NOSIZE_NOACTIVATE = 0x0013
$original = New-Object VaMouse+POINT
[void][VaMouse]::GetCursorPos([ref]$original)

# 다른 창에 가려 엉뚱한 곳을 누르지 않도록 잠시 맨 위에 둔다
[void][VaMouse]::SetWindowPos($hwnd, [IntPtr](-1), 0, 0, 0, 0, $NOMOVE_NOSIZE_NOACTIVATE)
try {
    [void][VaMouse]::SetCursorPos($X, $Y)
    Start-Sleep -Milliseconds 120
    $point = New-Object VaMouse+POINT
    [void][VaMouse]::GetCursorPos([ref]$point)
    if ($point.X -ne $X -or $point.Y -ne $Y) {
        @{ ok = $false; reason = "target point is outside the screen" } | ConvertTo-Json -Compress
        return
    }
    $under = [VaMouse]::GetAncestor([VaMouse]::WindowFromPoint($point), 2)
    if ($under -ne $hwnd) {
        @{ ok = $false; reason = "cursor is not over the app window" } | ConvertTo-Json -Compress
        return
    }

    if ($Action -eq "drag") {
        [VaMouse]::mouse_event($LEFTDOWN, 0, 0, 0, [UIntPtr]::Zero)
        Start-Sleep -Milliseconds 120
        $steps = 12
        for ($i = 1; $i -le $steps; $i++) {
            [void][VaMouse]::SetCursorPos($X + [int]($DX * $i / $steps), $Y + [int]($DY * $i / $steps))
            Start-Sleep -Milliseconds 25
        }
        Start-Sleep -Milliseconds 120
        [VaMouse]::mouse_event($LEFTUP, 0, 0, 0, [UIntPtr]::Zero)
    } else {
        foreach ($click in 1, 2) {
            [VaMouse]::mouse_event($LEFTDOWN, 0, 0, 0, [UIntPtr]::Zero)
            [VaMouse]::mouse_event($LEFTUP, 0, 0, 0, [UIntPtr]::Zero)
            Start-Sleep -Milliseconds 60
        }
    }
    Start-Sleep -Milliseconds 250
    @{ ok = $true } | ConvertTo-Json -Compress
} finally {
    [void][VaMouse]::SetWindowPos($hwnd, [IntPtr](-2), 0, 0, 0, 0, $NOMOVE_NOSIZE_NOACTIVATE)
    [void][VaMouse]::SetCursorPos($original.X, $original.Y)
}
