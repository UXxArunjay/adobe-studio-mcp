/**
 * Popup / modal-dialog watchdog for Adobe apps (Windows).
 * listDialogs(): finds dialog windows owned by AE / Premiere / Photoshop / Illustrator / Media Encoder and reads their
 * text + buttons (Win32 child windows + UI Automation). pressDialog(): clicks a button (UIA Invoke -> BM_CLICK -> keys).
 * The runner calls these while it waits for a job, so a popup is reported (or a plain OK-warning auto-dismissed) within
 * seconds instead of the call silently timing out. Notices are attached to the next tool result (see index.ts).
 */
import { execFile } from 'node:child_process';
import { APPS, AppId, IS_WIN } from '../config.js';

export interface DialogInfo { hwnd: number; process: string; app: AppId | null; title: string; class: string; width: number; height: number; text: string; buttons: string[] }

/** popup notices collected during the current tool call; index.ts appends + clears them */
export const NOTICES: string[] = [];
export function addNotice(s: string) { if (!NOTICES.includes(s)) NOTICES.push(s); }

const PROC_TO_APP: Record<string, AppId> = {};
for (const id of Object.keys(APPS) as AppId[]) PROC_TO_APP[APPS[id].winProcess.replace(/\.exe$/i, '').toLowerCase()] = id;

const PS_LIB = String.raw`
$ErrorActionPreference='SilentlyContinue'
Add-Type -AssemblyName UIAutomationClient,UIAutomationTypes,System.Windows.Forms
if (-not ([System.Management.Automation.PSTypeName]'AsmW').Type) {
Add-Type @"
using System;using System.Text;using System.Collections.Generic;using System.Runtime.InteropServices;
public class AsmW{
 public delegate bool EP(IntPtr h,IntPtr l);
 [DllImport("user32.dll")] public static extern bool EnumWindows(EP f,IntPtr l);
 [DllImport("user32.dll")] public static extern bool EnumChildWindows(IntPtr p,EP f,IntPtr l);
 [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
 [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h,out uint p);
 [DllImport("user32.dll",CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr h,StringBuilder s,int n);
 [DllImport("user32.dll",CharSet=CharSet.Unicode)] public static extern int GetClassName(IntPtr h,StringBuilder s,int n);
 [DllImport("user32.dll")] public static extern IntPtr GetWindow(IntPtr h,uint c);
 [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h,out RECT r);
 [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
 [DllImport("user32.dll")] public static extern IntPtr SendMessage(IntPtr h,uint m,IntPtr w,IntPtr l);
 [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr h,IntPtr hdc,uint f);
 [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
 public struct RECT{public int L,T,R,B;}
 public static List<IntPtr> Top(){var r=new List<IntPtr>();EnumWindows((h,l)=>{if(IsWindowVisible(h))r.Add(h);return true;},IntPtr.Zero);return r;}
 public static List<IntPtr> Kids(IntPtr p){var r=new List<IntPtr>();EnumChildWindows(p,(h,l)=>{r.Add(h);return true;},IntPtr.Zero);return r;}
 public static string T(IntPtr h){var s=new StringBuilder(2048);GetWindowText(h,s,2048);return s.ToString();}
 public static string C(IntPtr h){var s=new StringBuilder(256);GetClassName(h,s,256);return s.ToString();}
}
"@
}
[void][AsmW]::SetProcessDPIAware()
Add-Type -AssemblyName System.Drawing,System.Runtime.WindowsRuntime
function AsmAwait($op,[Type]$t){ $m=[System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name.StartsWith('IAsyncOperation') } | Select-Object -First 1; $tk=$m.MakeGenericMethod($t).Invoke($null,@($op)); [void]$tk.Wait(-1); $tk.Result }
# custom-drawn Adobe popups (AE "OS_ViewContainer") expose no text: capture the window (PrintWindow works even when covered) + Windows OCR
function Read-Ocr([IntPtr]$h){
 try {
  $null=[Windows.Storage.StorageFile,Windows.Storage,ContentType=WindowsRuntime]
  $null=[Windows.Media.Ocr.OcrEngine,Windows.Foundation,ContentType=WindowsRuntime]
  $null=[Windows.Graphics.Imaging.BitmapDecoder,Windows.Graphics,ContentType=WindowsRuntime]
  $r=New-Object AsmW+RECT; [void][AsmW]::GetWindowRect($h,[ref]$r)
  $bmp=New-Object System.Drawing.Bitmap ([Math]::Max(1,$r.R-$r.L)),([Math]::Max(1,$r.B-$r.T))
  $g=[System.Drawing.Graphics]::FromImage($bmp); $hdc=$g.GetHdc(); $ok=[AsmW]::PrintWindow($h,$hdc,2); $g.ReleaseHdc($hdc)
  if(-not $ok){ $g.CopyFromScreen($r.L,$r.T,0,0,$bmp.Size) }; $g.Dispose()
  $big=New-Object System.Drawing.Bitmap $bmp,($bmp.Width*2),($bmp.Height*2); $bmp.Dispose()
  $p=[IO.Path]::Combine($env:TEMP,"asm_dlg_$([int64]$h).png"); $big.Save($p,[System.Drawing.Imaging.ImageFormat]::Png); $big.Dispose()
  $f=AsmAwait ([Windows.Storage.StorageFile]::GetFileFromPathAsync($p)) ([Windows.Storage.StorageFile])
  $s=AsmAwait ($f.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream])
  $d=AsmAwait ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($s)) ([Windows.Graphics.Imaging.BitmapDecoder])
  $sb=AsmAwait ($d.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
  $e=[Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages()
  $o=AsmAwait ($e.RecognizeAsync($sb)) ([Windows.Media.Ocr.OcrResult])
  $s.Dispose(); Remove-Item $p -ErrorAction SilentlyContinue
  return @($o.Lines | ForEach-Object { $_.Text })
 } catch { return @() }
}
$procNames = @('afterfx','adobe premiere pro','photoshop','illustrator','adobe media encoder')
$procs=@{}; Get-Process | Where-Object { $procNames -contains $_.ProcessName.ToLower() } | ForEach-Object { $procs[[uint32]$_.Id]=$_.ProcessName }
$btnRx='^(OK|Cancel|Yes|No|Save|Don.t Save|Continue|Close|Retry|Ignore|Abort|Replace|Skip|Apply|Discard|Update|Later|Remind Me Later|Not Now|Locate|Done)$'
$titleRx='^(After Effects|Adobe After Effects|Premiere Pro|Adobe Premiere Pro|Photoshop|Adobe Photoshop|Illustrator|Adobe Illustrator|Media Encoder|Adobe Media Encoder|Warning|Error|Alert|Script Alert|ExtendScript)'
function Get-Dialogs {
 $out=@()
 foreach($h in [AsmW]::Top()){
  $p=[uint32]0; [void][AsmW]::GetWindowThreadProcessId($h,[ref]$p); if(-not $procs.ContainsKey($p)){continue}
  $r=New-Object AsmW+RECT; [void][AsmW]::GetWindowRect($h,[ref]$r); $w=$r.R-$r.L; $hh=$r.B-$r.T
  if($w -lt 100 -or $hh -lt 60){continue}
  $owner=[AsmW]::GetWindow($h,4); $cls=[AsmW]::C($h); $title=[AsmW]::T($h)
  $texts=New-Object System.Collections.ArrayList; $buttons=New-Object System.Collections.ArrayList
  foreach($k in [AsmW]::Kids($h)){ $t=[AsmW]::T($k); if(-not $t){continue}; if([AsmW]::C($k) -eq 'Button'){ if(-not $buttons.Contains($t)){[void]$buttons.Add($t)} } elseif(-not $texts.Contains($t)){[void]$texts.Add($t)} }
  $small = ($w -lt 1300 -and $hh -lt 900)
  $cand = ($cls -eq '#32770') -or ($small -and ($owner -ne [IntPtr]::Zero -or $title -match $titleRx))
  if(-not $cand){continue}
  try {
   $el=[System.Windows.Automation.AutomationElement]::FromHandle($h)
   $all=$el.FindAll([System.Windows.Automation.TreeScope]::Descendants,[System.Windows.Automation.Condition]::TrueCondition)
   foreach($e in $all){ $n=$e.Current.Name; if(-not $n){continue}; if($e.Current.ControlType.ProgrammaticName -eq 'ControlType.Button'){ if(-not $buttons.Contains($n)){[void]$buttons.Add($n)} } elseif(-not $texts.Contains($n) -and $n -ne $title){ [void]$texts.Add($n) } }
  } catch {}
  $real = @($texts | Where-Object { $_ -notmatch '^OS_' -and -not $buttons.Contains($_) })
  $ocr = $false
  if($real.Count -eq 0){
   $lines = Read-Ocr $h; $ocr = $true
   foreach($ln in $lines){ $c=$ln.Trim(); if(-not $c){continue}; if($c -match '^[0O][Kk]$'){ $c='OK' }; if($c -match $btnRx){ if(-not $buttons.Contains($c)){[void]$buttons.Add($c)} } else { $real += $c } }
  }
  $texts = $real
  $hasStdBtn = @($buttons | Where-Object { ($_ -replace '&','') -match $btnRx }).Count -gt 0
  if(-not ($cls -eq '#32770' -or $hasStdBtn -or ($title -match $titleRx -and $small))){continue}
  $out += [pscustomobject]@{hwnd=[int64]$h; process=$procs[$p]; title=$title; class=$cls; width=$w; height=$hh; ocr=$ocr; text=(($texts | Select-Object -First 40) -join "\n"); buttons=@($buttons | ForEach-Object { $_ -replace '&','' })}
 }
 return ,$out
}
function Press-Dialog([int64]$hw,[string]$btn){
 $h=[IntPtr]$hw
 try {
  $el=[System.Windows.Automation.AutomationElement]::FromHandle($h)
  $cond=New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ControlTypeProperty,[System.Windows.Automation.ControlType]::Button)
  foreach($b in $el.FindAll([System.Windows.Automation.TreeScope]::Descendants,$cond)){
   if(($b.Current.Name -replace '&','') -ieq $btn){ $ip=$b.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern); $ip.Invoke(); return 'uia' }
  }
 } catch {}
 foreach($k in [AsmW]::Kids($h)){ if([AsmW]::C($k) -eq 'Button' -and (([AsmW]::T($k)) -replace '&','') -ieq $btn){ [void][AsmW]::SendMessage($k,0x00F5,[IntPtr]::Zero,[IntPtr]::Zero); return 'bm_click' } }
 [void][AsmW]::SetForegroundWindow($h); Start-Sleep -Milliseconds 150
 if($btn -match '^(Cancel|Close|No|Don.t Save|Discard)$'){ [System.Windows.Forms.SendKeys]::SendWait('{ESC}'); return 'key_esc' }
 [System.Windows.Forms.SendKeys]::SendWait('{ENTER}'); return 'key_enter'
}
`;

function runPs(script: string, timeout = 15000): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
      { timeout, windowsHide: true, maxBuffer: 16 * 1024 * 1024 }, (err, stdout, stderr) => (err && !stdout ? reject(new Error(String(stderr || err.message))) : resolve(stdout)));
  });
}

function parse(stdout: string): any { const s = stdout.trim(); const i = s.indexOf('{'); return JSON.parse(i > 0 ? s.slice(i) : s); }

/** Lists open popups/dialogs of Adobe apps (optionally only one app). [] on non-Windows or on any failure. */
export async function listDialogs(app?: AppId): Promise<DialogInfo[]> {
  if (!IS_WIN) return [];
  try {
    const out = await runPs(`${PS_LIB}\n$d = Get-Dialogs; @{dialogs=@($d)} | ConvertTo-Json -Depth 5 -Compress`);
    const list: any[] = parse(out).dialogs || [];
    return list.map((d) => ({ hwnd: Number(d.hwnd), process: String(d.process), app: PROC_TO_APP[String(d.process).toLowerCase()] || null, title: String(d.title || ''), class: String(d.class || ''),
      width: Number(d.width), height: Number(d.height), text: String(d.text || '').replace(/\\n/g, '\n'), buttons: ([] as any[]).concat(d.buttons || []).map(String) }))
      .filter((d) => !app || d.app === app);
  } catch { return []; }
}

/** Presses `button` (default OK) on the dialog with this window handle. */
export async function pressDialog(hwnd: number, button = 'OK'): Promise<{ pressed: boolean; method: string }> {
  if (!IS_WIN) return { pressed: false, method: 'unsupported-platform' };
  const b = button.replace(/'/g, "''");
  const out = await runPs(`${PS_LIB}\n$m = Press-Dialog ${Math.trunc(hwnd)} '${b}'; @{method=[string]$m} | ConvertTo-Json -Compress`);
  const m = String(parse(out).method || '');
  return { pressed: !!m, method: m };
}

/** a plain information/warning popup that only offers OK/Close — safe to auto-dismiss */
export function isSafeToAutoDismiss(d: DialogInfo): boolean {
  const btns = d.buttons.map((x) => x.trim().toLowerCase()).filter(Boolean);
  if (btns.length === 0) return /warning|error|could not|cannot|unable to|not found|failed|missing|invalid|script/i.test(d.text + ' ' + d.title) && !/save|discard|replace|overwrite|delete/i.test(d.text);
  return btns.every((b) => b === 'ok' || b === 'close');
}

export function describeDialog(d: DialogInfo): string {
  const text = d.text.replace(/\s+/g, ' ').trim();
  return `[${d.process}] "${d.title}"${text ? `: ${text}` : ''}${d.buttons.length ? ` — buttons: ${d.buttons.join(' / ')}` : ''} (hwnd ${d.hwnd})`;
}

/**
 * Called by the runner while it waits for a job. Auto-dismisses plain OK-warnings (recording a notice) and returns the
 * dialogs that still need a decision (caller throws so the agent can read them and answer with adobe_dialogs).
 */
export async function handleDialogs(app: AppId): Promise<DialogInfo[]> {
  const ds = await listDialogs(app);
  const pending: DialogInfo[] = [];
  for (const d of ds) {
    if (isSafeToAutoDismiss(d) && process.env.ADOBE_MCP_AUTO_DISMISS !== '0') {
      const btn = d.buttons.find((x) => /^ok$/i.test(x)) || d.buttons.find((x) => /^close$/i.test(x)) || 'OK';
      let how = 'failed';
      try { const r = await pressDialog(d.hwnd, btn); how = r.method; } catch { /* report below */ }
      addNotice(`Popup auto-dismissed (${btn}, ${how}): ${describeDialog(d)}`);
    } else pending.push(d);
  }
  return pending;
}
