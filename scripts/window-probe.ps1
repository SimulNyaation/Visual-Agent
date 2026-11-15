# 앱 창의 상태를 묻거나 창 버튼을 누른 것과 같은 신호를 보낸다. 결과는 JSON 한 줄로 출력한다.
# 마우스 커서는 움직이지 않는다.
# 사용: window-probe.ps1 -ProcessId <pid> -Action info|hit|ncclick|close|restore [-X n -Y n] [-Hit n]
param(
    [Parameter(Mandatory = $true)][int]$ProcessId,
    [Parameter(Mandatory = $true)][ValidateSet("info", "hit", "ncclick", "close", "restore", "place", "dialog", "closedialog")][string]$Action,
    [int]$X = 0,
    [int]$Y = 0,
    [int]$Hit = 0,
    [int]$Width = 0,
    [int]$Height = 0,
    [switch]$Caption
)

Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class VaProbe {
    [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
    [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X, Y; }
    [StructLayout(LayoutKind.Sequential)] public struct MONITORINFO { public int Size; public RECT Monitor; public RECT Work; public uint Flags; }
    [DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(IntPtr value);
    [DllImport("user32.dll")] public static extern bool GetClientRect(IntPtr hwnd, out RECT rect);
    [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hwnd, out RECT rect);
    [DllImport("user32.dll")] public static extern bool ClientToScreen(IntPtr hwnd, ref POINT point);
    [DllImport("user32.dll")] public static extern bool IsZoomed(IntPtr hwnd);
    [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hwnd);
    [DllImport("user32.dll")] public static extern uint GetDpiForWindow(IntPtr hwnd);
    [DllImport("user32.dll")] public static extern IntPtr MonitorFromWindow(IntPtr hwnd, uint flags);
    [DllImport("user32.dll")] public static extern bool GetMonitorInfo(IntPtr monitor, ref MONITORINFO info);
    [DllImport("user32.dll")] public static extern IntPtr SendMessage(IntPtr hwnd, uint message, IntPtr wParam, IntPtr lParam);
    [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr hwnd, uint message, IntPtr wParam, IntPtr lParam);
    [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hwnd, int command);
    [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr hwnd, IntPtr after, int x, int y, int cx, int cy, uint flags);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern IntPtr FindWindowEx(IntPtr parent, IntPtr after, string className, string title);
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint processId);
    [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hwnd);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr hwnd, System.Text.StringBuilder text, int max);

    // 이 프로세스가 띄운 대화 상자(폴더 선택 창)를 찾는다. 없으면 0
    public static IntPtr FindDialog(uint processId) {
        IntPtr current = IntPtr.Zero;
        while ((current = FindWindowEx(IntPtr.Zero, current, "#32770", null)) != IntPtr.Zero) {
            uint owner;
            GetWindowThreadProcessId(current, out owner);
            if (owner == processId && IsWindowVisible(current)) return current;
        }
        return IntPtr.Zero;
    }
    public static string Title(IntPtr hwnd) {
        var text = new System.Text.StringBuilder(256);
        GetWindowText(hwnd, text, text.Capacity);
        return text.ToString();
    }
}
'@
[void][VaProbe]::SetProcessDpiAwarenessContext([IntPtr](-4))

if ($Action -eq "dialog" -or $Action -eq "closedialog") {
    $dialog = [VaProbe]::FindDialog([uint32]$ProcessId)
    if ($dialog -eq [IntPtr]::Zero) { @{ open = $false } | ConvertTo-Json -Compress; return }
    $title = [VaProbe]::Title($dialog)
    if ($Action -eq "closedialog") { [void][VaProbe]::PostMessage($dialog, 0x0010, [IntPtr]::Zero, [IntPtr]::Zero) }
    # 한글 제목이 출력 과정에서 깨지지 않도록 글자 코드로 보낸다
    @{ open = $true; titleCodes = @($title.ToCharArray() | ForEach-Object { [int]$_ }) } | ConvertTo-Json -Compress
    return
}

$process = Get-Process -Id $ProcessId -ErrorAction Stop
$hwnd = $process.MainWindowHandle
if ($hwnd -eq [IntPtr]::Zero) { throw "프로세스 $ProcessId 의 창을 찾을 수 없습니다." }

# -Caption을 주면 앱 창 대신 그 위에 얹힌 창 버튼 영역에 신호를 보낸다
function Target {
    if (-not $Caption) { return $hwnd }
    $child = [VaProbe]::FindWindowEx($hwnd, [IntPtr]::Zero, "VisualAgentCaption", $null)
    if ($child -eq [IntPtr]::Zero) { throw "caption window not found" }
    return $child
}

function ToLParam([int]$px, [int]$py) { [IntPtr]((($py -band 0xFFFF) -shl 16) -bor ($px -band 0xFFFF)) }

$WM_NCHITTEST = 0x0084; $WM_NCLBUTTONDOWN = 0x00A1; $WM_NCLBUTTONUP = 0x00A2; $WM_CLOSE = 0x0010

switch ($Action) {
    "info" {
        $client = New-Object VaProbe+RECT; [void][VaProbe]::GetClientRect($hwnd, [ref]$client)
        $origin = New-Object VaProbe+POINT; [void][VaProbe]::ClientToScreen($hwnd, [ref]$origin)
        $window = New-Object VaProbe+RECT; [void][VaProbe]::GetWindowRect($hwnd, [ref]$window)
        $monitor = New-Object VaProbe+MONITORINFO; $monitor.Size = 40
        [void][VaProbe]::GetMonitorInfo([VaProbe]::MonitorFromWindow($hwnd, 2), [ref]$monitor)
        @{
            title   = $process.MainWindowTitle
            zoomed  = [VaProbe]::IsZoomed($hwnd)
            iconic  = [VaProbe]::IsIconic($hwnd)
            dpi     = [VaProbe]::GetDpiForWindow($hwnd)
            client  = @{ left = $origin.X; top = $origin.Y; right = $origin.X + $client.Right; bottom = $origin.Y + $client.Bottom }
            window  = @{ left = $window.Left; top = $window.Top; right = $window.Right; bottom = $window.Bottom }
            work    = @{ left = $monitor.Work.Left; top = $monitor.Work.Top; right = $monitor.Work.Right; bottom = $monitor.Work.Bottom }
        } | ConvertTo-Json -Compress
    }
    "hit" {
        $code = [VaProbe]::SendMessage((Target), $WM_NCHITTEST, [IntPtr]::Zero, (ToLParam $X $Y))
        @{ hit = $code.ToInt64() } | ConvertTo-Json -Compress
    }
    "ncclick" {
        [void][VaProbe]::SendMessage((Target), $WM_NCLBUTTONDOWN, [IntPtr]$Hit, [IntPtr]::Zero)
        [void][VaProbe]::SendMessage((Target), $WM_NCLBUTTONUP, [IntPtr]$Hit, [IntPtr]::Zero)
        @{ ok = $true } | ConvertTo-Json -Compress
    }
    "close" {
        [void][VaProbe]::PostMessage($hwnd, $WM_CLOSE, [IntPtr]::Zero, [IntPtr]::Zero)
        @{ ok = $true } | ConvertTo-Json -Compress
    }
    "place" {
        [void][VaProbe]::SetWindowPos($hwnd, [IntPtr]::Zero, $X, $Y, $Width, $Height, 0x0014)
        @{ ok = $true } | ConvertTo-Json -Compress
    }
    "restore" {
        [void][VaProbe]::ShowWindow($hwnd, 9)
        @{ ok = $true } | ConvertTo-Json -Compress
    }
}
