# 실제 키보드 입력을 앱 창에 보낸다. 앱 창이 맨 앞에 있지 않으면 아무것도 누르지 않고 멈춘다.
# 먼저 mouse-probe.ps1로 앱 창을 클릭해 맨 앞으로 가져온 뒤에 쓴다.
# 사용: key-probe.ps1 -ProcessId <pid> -Keys "F2,2,Enter"   (쉼표로 구분. Ctrl+C 처럼 조합 가능. 한 글자는 숫자만 쓴다: 한글 입력 상태의 영향을 받지 않도록)
#       key-probe.ps1 -ProcessId <pid> -Text "echo hello"    (글자를 그대로 친다. 한글 입력 상태와 상관없이 그 글자가 들어간다)
param(
    [Parameter(Mandatory = $true)][int]$ProcessId,
    [string]$Keys = "",
    [string]$Text = ""
)

Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class VaKeys {
    [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] public static extern IntPtr GetAncestor(IntPtr hwnd, uint flags);
    [DllImport("user32.dll")] public static extern void keybd_event(byte key, byte scan, uint flags, UIntPtr extra);
    [DllImport("user32.dll")] public static extern uint MapVirtualKey(uint code, uint mapType);

    [StructLayout(LayoutKind.Sequential)] public struct KEYBDINPUT { public ushort vk; public ushort scan; public uint flags; public uint time; public IntPtr extra; }
    [StructLayout(LayoutKind.Explicit)] public struct INPUT {
        [FieldOffset(0)] public uint type;
        [FieldOffset(8)] public KEYBDINPUT key;
        // 가장 큰 종류(마우스 입력)의 크기에 맞춘다
        [FieldOffset(32)] public long padding;
    }
    [DllImport("user32.dll", SetLastError = true)] public static extern uint SendInput(uint count, INPUT[] inputs, int size);

    // 글자 하나를 키보드로 친 것처럼 보낸다
    public static void TypeChar(char c) {
        var inputs = new INPUT[2];
        inputs[0].type = 1; inputs[0].key.scan = c; inputs[0].key.flags = 0x0004;
        inputs[1].type = 1; inputs[1].key.scan = c; inputs[1].key.flags = 0x0004 | 0x0002;
        SendInput(2, inputs, Marshal.SizeOf(typeof(INPUT)));
    }
}
'@

$hwnd = (Get-Process -Id $ProcessId -ErrorAction Stop).MainWindowHandle
if ($hwnd -eq [IntPtr]::Zero) { throw "window not found for process $ProcessId" }

$codes = @{
    "CTRL" = 0x11; "SHIFT" = 0x10; "ENTER" = 0x0D; "ESCAPE" = 0x1B; "DELETE" = 0x2E; "F2" = 0x71
    "UP" = 0x26; "DOWN" = 0x28; "LEFT" = 0x25; "RIGHT" = 0x27
    "C" = 0x43; "V" = 0x56; "X" = 0x58; "Z" = 0x5A
}
# 방향키와 Delete는 확장 키로 보내야 숫자 키패드의 키로 읽히지 않는다
$extended = @(0x2E, 0x25, 0x26, 0x27, 0x28)
$KEYUP = 0x0002; $EXTENDED = 0x0001

function CodeOf([string]$name) {
    $upper = $name.ToUpper()
    if ($codes.ContainsKey($upper)) { return $codes[$upper] }
    if ($upper -match '^[0-9]$') { return 0x30 + [int]$upper }
    throw "unknown key: $name"
}

# 실제 키보드처럼 키의 물리 위치 값(스캔 코드)도 함께 보낸다
function ScanOf([int]$code) { return [byte][VaKeys]::MapVirtualKey([uint32]$code, 0) }

function InFront() { return [VaKeys]::GetAncestor([VaKeys]::GetForegroundWindow(), 2) -eq $hwnd }

foreach ($char in $Text.ToCharArray()) {
    if (-not (InFront)) {
        @{ ok = $false; reason = "app window is not in front" } | ConvertTo-Json -Compress
        return
    }
    [VaKeys]::TypeChar($char)
    Start-Sleep -Milliseconds 15
}

foreach ($combo in @($Keys.Split(",") | Where-Object { $_.Trim() -ne "" })) {
    $front = [VaKeys]::GetAncestor([VaKeys]::GetForegroundWindow(), 2)
    if ($front -ne $hwnd) {
        @{ ok = $false; reason = "app window is not in front" } | ConvertTo-Json -Compress
        return
    }
    $parts = @($combo.Trim().Split("+") | ForEach-Object { CodeOf $_ })
    foreach ($code in $parts) {
        $flags = 0; if ($extended -contains $code) { $flags = $EXTENDED }
        [VaKeys]::keybd_event([byte]$code, (ScanOf $code), $flags, [UIntPtr]::Zero)
    }
    Start-Sleep -Milliseconds 40
    [array]::Reverse($parts)
    foreach ($code in $parts) {
        $flags = $KEYUP; if ($extended -contains $code) { $flags = $KEYUP -bor $EXTENDED }
        [VaKeys]::keybd_event([byte]$code, (ScanOf $code), $flags, [UIntPtr]::Zero)
    }
    Start-Sleep -Milliseconds 120
}
@{ ok = $true } | ConvertTo-Json -Compress
