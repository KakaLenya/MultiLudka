# Пульт казино-зала: запускает сервер и туннель cloudflared и показывает ссылки в одном окне.
# Запускается из start.bat. Закрыть окно = выключить зал (аккуратно, как Ctrl+C: фишки вернутся).
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
[System.Windows.Forms.Application]::EnableVisualStyles()

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $root
$port = if ($env:CASINO_PORT) { [int]$env:CASINO_PORT } else { 3000 }
$local = "http://127.0.0.1:$port"
$dataDir = if ($env:DATA_DIR) { $env:DATA_DIR } else { Join-Path $root 'data' }
$logs = Join-Path $dataDir 'logs'
New-Item -ItemType Directory -Force $logs | Out-Null

$cf = $env:CASINO_CF
if (-not $cf) {
  $cmd = Get-Command cloudflared -ErrorAction SilentlyContinue
  $cf = if ($cmd) { $cmd.Source } else { Join-Path ${env:ProgramFiles(x86)} 'cloudflared\cloudflared.exe' }
}

$script:server = $null       # процесс сервера, если запустили его мы
$script:tunnel = $null       # процесс туннеля, если запустили его мы
$script:hostName = $null     # xxx.trycloudflare.com
$script:closing = $false
$script:retryAt = $null      # когда снова запускать упавший туннель
$script:failures = 0         # сколько раз подряд туннель не поднялся
$script:ticks = 0
$script:startedAt = Get-Date
$script:own = $false         # туннелем управляем мы (а не подхватили чужой)
$script:attempt = 0          # номер попытки: нечётные — через запрос, чётные — обычный cloudflared
$script:req = $null          # процесс curl, который запрашивает туннель
$script:apiHost = $null      # ссылка, выданная по запросу (готова, когда cloudflared подключится)
$curl = (Get-Command curl.exe -ErrorAction SilentlyContinue).Source

# ---------- Проверки ----------

function Test-Port {
  $c = New-Object System.Net.Sockets.TcpClient
  try {
    $t = $c.ConnectAsync('127.0.0.1', $port)
    return ($t.Wait(300) -and $c.Connected)
  } catch { return $false } finally { $c.Close() }
}

# Журнал нашего туннеля (файл занят cloudflared, читаем с общим доступом).
function Read-TunnelLog {
  $file = Join-Path $logs 'tunnel.log'
  if (-not (Test-Path $file)) { return '' }
  try {
    $fs = [System.IO.File]::Open($file, 'Open', 'Read', 'ReadWrite')
    $reader = New-Object System.IO.StreamReader($fs)
    $content = $reader.ReadToEnd()
    $reader.Close()
    return $content
  } catch { return '' }
}

# Ссылка нашего туннеля: выданная по запросу — когда cloudflared подключился, иначе — из журнала.
function Get-OwnTunnelHost {
  if ($script:req) { return $null }   # туннель ещё запрашивается
  $content = Read-TunnelLog
  if ($script:apiHost) {
    if ($content -match 'Registered tunnel connection') { return $script:apiHost }
    return $null
  }
  # Ссылка зала — из нескольких слов через дефис (api.trycloudflare.com — это сам Cloudflare).
  $m = [regex]::Match($content, 'https://([a-z0-9]+(?:-[a-z0-9]+)+\.trycloudflare\.com)')
  if ($m.Success) { return $m.Groups[1].Value }
  return $null
}

# Туннель, запущенный не отсюда: cloudflared говорит свою ссылку на служебном порту 20241 (или следующих).
function Get-TunnelHost {
  foreach ($p in 20241..20245) {
    try {
      $r = Invoke-RestMethod -Uri "http://127.0.0.1:$p/quicktunnel" -TimeoutSec 1
      if ($r.hostname) { return $r.hostname }
    } catch { }
  }
  return $null
}

# ---------- Запуск и остановка ----------

function Start-Server {
  if (Test-Port) { return }   # уже работает (например, запущен из Claude)
  $env:PORT = $port
  $script:server = Start-Process -FilePath 'node' -ArgumentList 'server\index.js' -WorkingDirectory $root `
    -WindowStyle Hidden -PassThru `
    -RedirectStandardOutput (Join-Path $logs 'server.log') -RedirectStandardError (Join-Path $logs 'server-errors.log')
}

function Start-Cloudflared($arguments) {
  $script:tunnel = Start-Process -FilePath $cf -ArgumentList $arguments -WindowStyle Hidden -PassThru `
    -RedirectStandardOutput (Join-Path $logs 'tunnel-out.log') -RedirectStandardError (Join-Path $logs 'tunnel.log')
}

# Два способа получить быструю ссылку, по очереди, пока один не сработает:
# 1) запросить туннель у Cloudflare самим (curl, HTTP/1.1) и дать cloudflared готовые ключи —
#    так работает, даже когда cloudflared не дожидается ответа Cloudflare («context deadline exceeded»);
# 2) обычный cloudflared tunnel --url.
function Start-Tunnel {
  Stop-Tunnel
  Remove-Item (Join-Path $logs 'tunnel.log') -ErrorAction SilentlyContinue   # чтобы не прочитать старую ссылку
  $script:own = $true
  $script:attempt++
  if ($curl -and $script:attempt % 2 -eq 1) {
    $out = Join-Path $logs 'quick-tunnel-request.json'
    Remove-Item $out -ErrorAction SilentlyContinue
    $script:req = Start-Process -FilePath $curl -WindowStyle Hidden -PassThru `
      -ArgumentList '-4', '-s', '-m', '40', '-X', 'POST', 'https://api.trycloudflare.com/tunnel', '-o', "`"$out`""
  } else {
    Start-Cloudflared @('tunnel', '--no-autoupdate', '--protocol', 'http2', '--url', $local)
  }
}

# Запрос туннеля закончился: ключи — в файл, cloudflared — подключаться.
function Complete-TunnelRequest {
  $out = Join-Path $logs 'quick-tunnel-request.json'
  $r = $null
  try { $r = (Get-Content $out -Raw | ConvertFrom-Json).result } catch { }
  if (-not $r -or -not $r.id) { Set-TunnelFailed; return }
  $creds = Join-Path $logs 'quick-tunnel.json'
  @{ AccountTag = $r.account_tag; TunnelSecret = $r.secret; TunnelID = $r.id } | ConvertTo-Json | Set-Content -Path $creds -Encoding ASCII
  $script:apiHost = $r.hostname
  Start-Cloudflared @('tunnel', '--no-autoupdate', '--protocol', 'http2', '--url', $local, 'run', '--credentials-file', "`"$creds`"", $r.id)
}

function Set-TunnelFailed {
  $script:hostName = $null
  $script:failures++
  $script:retryAt = (Get-Date).AddSeconds(5)
}

function Stop-Tunnel {
  if ($script:req -and -not $script:req.HasExited) { Stop-Process -Id $script:req.Id -Force -ErrorAction SilentlyContinue }
  if ($script:tunnel -and -not $script:tunnel.HasExited) { Stop-Process -Id $script:tunnel.Id -Force -ErrorAction SilentlyContinue }
  $script:req = $null
  $script:tunnel = $null
  $script:hostName = $null
  $script:apiHost = $null
  $script:retryAt = $null
}

# Аккуратная остановка: сервер сам вернёт фишки из игр и сохранит данные.
function Stop-Server {
  if (-not (Test-Port)) { return }
  try { Invoke-RestMethod -Method Post -Uri "$local/admin/api/shutdown" -TimeoutSec 3 | Out-Null } catch { }
  for ($i = 0; $i -lt 30 -and (Test-Port); $i++) { Start-Sleep -Milliseconds 200 }
  if ($script:server -and -not $script:server.HasExited) { Stop-Process -Id $script:server.Id -Force -ErrorAction SilentlyContinue }
  $script:server = $null
}

# ---------- Окно ----------

$bg = [System.Drawing.Color]::FromArgb(13, 26, 19)
$card = [System.Drawing.Color]::FromArgb(22, 40, 30)
$text = [System.Drawing.Color]::FromArgb(236, 230, 214)
$muted = [System.Drawing.Color]::FromArgb(150, 160, 150)
$gold = [System.Drawing.Color]::FromArgb(242, 193, 78)
$green = [System.Drawing.Color]::FromArgb(69, 212, 131)
$red = [System.Drawing.Color]::FromArgb(229, 97, 91)

$form = New-Object System.Windows.Forms.Form
$form.Text = 'Казино-зал'
$form.ClientSize = New-Object System.Drawing.Size(660, 470)
$form.FormBorderStyle = 'FixedSingle'
$form.MaximizeBox = $false
$form.StartPosition = 'CenterScreen'
$form.BackColor = $bg
$form.ForeColor = $text
$form.Font = New-Object System.Drawing.Font('Segoe UI', 10)

function New-Label($t, $x, $y, $size = 10, $style = 'Regular', $color = $text) {
  $l = New-Object System.Windows.Forms.Label
  $l.Text = $t
  $l.Location = New-Object System.Drawing.Point($x, $y)
  $l.AutoSize = $true
  $l.ForeColor = $color
  $l.Font = New-Object System.Drawing.Font('Segoe UI', $size, [System.Drawing.FontStyle]::$style)
  $form.Controls.Add($l)
  return $l
}

function New-Box($y) {
  $t = New-Object System.Windows.Forms.TextBox
  $t.Location = New-Object System.Drawing.Point(20, $y)
  $t.Size = New-Object System.Drawing.Size(400, 28)
  $t.ReadOnly = $true
  $t.BackColor = $card
  $t.ForeColor = $text
  $t.BorderStyle = 'FixedSingle'
  $t.Font = New-Object System.Drawing.Font('Consolas', 10)
  $form.Controls.Add($t)
  return $t
}

function New-Button($t, $x, $y, $w, $primary = $false) {
  $b = New-Object System.Windows.Forms.Button
  $b.Text = $t
  $b.Location = New-Object System.Drawing.Point($x, $y)
  $b.Size = New-Object System.Drawing.Size($w, 30)
  $b.FlatStyle = 'Flat'
  $b.Cursor = 'Hand'
  if ($primary) {
    $b.BackColor = $gold
    $b.ForeColor = [System.Drawing.Color]::FromArgb(42, 27, 2)
    $b.FlatAppearance.BorderSize = 0
  } else {
    $b.BackColor = $card
    $b.ForeColor = $text
    $b.FlatAppearance.BorderColor = [System.Drawing.Color]::FromArgb(60, 80, 66)
  }
  $form.Controls.Add($b)
  return $b
}

# Скопировать и коротко показать «Скопировано» на кнопке.
function Copy-Text($button, $value) {
  if (-not $value) { return }
  [System.Windows.Forms.Clipboard]::SetText($value)
  $old = $button.Text
  $button.Text = 'Скопировано ✓'
  $t = New-Object System.Windows.Forms.Timer
  $t.Interval = 1400
  $t.Add_Tick({ param($s) $button.Text = $old; $s.Stop() }.GetNewClosure())
  $t.Start()
}

New-Label '♠ Казино-зал' 18 14 18 'Bold' $gold | Out-Null
$serverLabel = New-Label 'Сервер: запускается…' 20 60 10 'Regular' $muted
$tunnelLabel = New-Label 'Туннель: получаю ссылку…' 330 60 10 'Regular' $muted

New-Label 'Ссылка для друзей' 20 100 11 'Bold' | Out-Null
New-Label 'Отправь её друзьям. При каждом запуске ссылка новая.' 20 122 9 'Regular' $muted | Out-Null
$friendsBox = New-Box 148
$friendsBox.Text = 'появится через ~10 секунд…'
$friendsCopy = New-Button 'Копировать' 430 147 105 $true
$friendsOpen = New-Button 'Открыть' 542 147 98

New-Label 'Админка на этом компьютере' 20 196 11 'Bold' | Out-Null
$adminBox = New-Box 222
$adminBox.Text = "$local/admin.html"
$adminOpen = New-Button 'Открыть' 430 221 105 $true
$adminCopy = New-Button 'Копировать' 542 221 98

New-Label 'Админка с телефона (через туннель)' 20 270 11 'Bold' | Out-Null
New-Label 'Откроется по ссылке ниже и попросит токен — скопируй его кнопкой.' 20 292 9 'Regular' $muted | Out-Null
$phoneBox = New-Box 318
$phoneBox.Text = '—'
$phoneCopy = New-Button 'Ссылка' 430 317 105
$tokenCopy = New-Button 'Токен' 542 317 98

$newLink = New-Button '↻ Новая ссылка' 20 380 190
$restart = New-Button '↻ Перезапустить сервер' 220 380 220
$stop = New-Button 'Выключить зал' 450 380 190
$stop.ForeColor = $red

New-Label 'Закрыть это окно = выключить зал. Фишки со столов вернутся игрокам.' 20 428 9 'Regular' $muted | Out-Null

$friendsCopy.Add_Click({ Copy-Text $friendsCopy $(if ($script:hostName) { "https://$($script:hostName)" }) })
$friendsOpen.Add_Click({ if ($script:hostName) { Start-Process "https://$($script:hostName)" } })
$adminOpen.Add_Click({ Start-Process "$local/admin.html" })
$adminCopy.Add_Click({ Copy-Text $adminCopy "$local/admin.html" })
$phoneCopy.Add_Click({ Copy-Text $phoneCopy $(if ($script:hostName) { "https://$($script:hostName)/admin.html" }) })
$tokenCopy.Add_Click({
  $file = Join-Path $dataDir 'admin.token'
  if (Test-Path $file) { Copy-Text $tokenCopy ((Get-Content $file -Raw).Trim()) }
})
$newLink.Add_Click({
  $friendsBox.Text = 'новая ссылка через ~10 секунд…'
  $script:failures = 0
  Start-Tunnel
})
$restart.Add_Click({
  $serverLabel.Text = 'Сервер: перезапускаю…'
  $serverLabel.ForeColor = $muted
  $form.Refresh()
  Stop-Server
  Start-Server
})
$stop.Add_Click({ $form.Close() })

# ---------- Обновление статуса ----------

$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = 1500
$timer.Add_Tick({
  if (Test-Port) {
    $serverLabel.Text = 'Сервер: ● работает'
    $serverLabel.ForeColor = $green
  } else {
    $serverLabel.Text = 'Сервер: ● не отвечает'
    $serverLabel.ForeColor = $red
  }
  $script:ticks++
  if ($script:req -and $script:req.HasExited) {
    $script:req = $null
    Complete-TunnelRequest
  }
  # cloudflared завершился: не достучался до Cloudflare или упал. Через 5 с — другим способом.
  if ($script:tunnel -and $script:tunnel.HasExited -and -not $script:retryAt) { Set-TunnelFailed }
  if ($script:retryAt) {
    if ((Get-Date) -ge $script:retryAt) { Start-Tunnel }
  } elseif ($script:own) {
    if (-not $script:hostName) { $script:hostName = Get-OwnTunnelHost }
  } elseif (-not $script:hostName) {
    $script:hostName = Get-TunnelHost
    # Чужого туннеля так и не нашлось — поднимаем свой.
    if (-not $script:hostName -and ((Get-Date) - $script:startedAt).TotalSeconds -gt 8) { Start-Tunnel }
  } elseif ($script:ticks % 7 -eq 0 -and -not (Get-TunnelHost)) {
    $script:hostName = $null   # чужой туннель пропал — на следующем тике поднимем свой
    $script:startedAt = Get-Date
  }

  if ($script:hostName) {
    $script:failures = 0
    $tunnelLabel.Text = 'Туннель: ● ссылка готова'
    $tunnelLabel.ForeColor = $green
    $friendsBox.Text = "https://$($script:hostName)"
    $phoneBox.Text = "https://$($script:hostName)/admin.html"
  } elseif ($script:failures -gt 0) {
    $tunnelLabel.Text = 'Туннель: ● нет связи с Cloudflare, пробую снова…'
    $tunnelLabel.ForeColor = $red
    $friendsBox.Text = "нет связи с Cloudflare, попытка №$($script:failures + 1)…"
    $phoneBox.Text = '—'
  } else {
    $tunnelLabel.Text = 'Туннель: получаю ссылку…'
    $tunnelLabel.ForeColor = $muted
  }
})

$form.Add_FormClosing({
  param($s, $e)
  if ($script:closing) { return }
  $answer = [System.Windows.Forms.MessageBox]::Show(
    'Выключить зал? Игроки не смогут зайти, пока не запустишь снова.',
    'Казино-зал', 'YesNo', 'Question')
  if ($answer -ne 'Yes') { $e.Cancel = $true; return }
  $script:closing = $true
  $timer.Stop()
  $serverLabel.Text = 'Выключаю…'
  $form.Refresh()
  Stop-Server
  Stop-Tunnel
})

# ---------- Старт ----------

$serverWasRunning = Test-Port
Start-Server
# Сервер уже работал (запущен не отсюда) — скорее всего, и туннель к нему есть: берём его ссылку.
if ($serverWasRunning) { $script:hostName = Get-TunnelHost }
if (-not $script:hostName) { Start-Tunnel }

# Для проверки без человека: CASINO_SNAPSHOT=путь.png — снимок окна через 12 с и выход без остановки зала.
if ($env:CASINO_SNAPSHOT) {
  $snap = New-Object System.Windows.Forms.Timer
  $snap.Interval = if ($env:CASINO_SNAPSHOT_MS) { [int]$env:CASINO_SNAPSHOT_MS } else { 12000 }
  $snap.Add_Tick({
    $snap.Stop()
    $bmp = New-Object System.Drawing.Bitmap($form.Width, $form.Height)
    $form.DrawToBitmap($bmp, (New-Object System.Drawing.Rectangle(0, 0, $form.Width, $form.Height)))
    $bmp.Save($env:CASINO_SNAPSHOT, [System.Drawing.Imaging.ImageFormat]::Png)
    $script:closing = $true
    $form.Close()
  })
  $snap.Start()
}

$timer.Start()
[void]$form.ShowDialog()
