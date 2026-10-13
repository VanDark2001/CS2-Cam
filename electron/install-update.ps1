param([Parameter(Mandatory=$true)][string]$Plan,[switch]$PrepareOnly,[switch]$NoRestart)
$ErrorActionPreference='Stop'
$nativeModulePath=Join-Path $env:SystemRoot 'System32/WindowsPowerShell/v1.0/Modules'
$env:PSModulePath=$nativeModulePath+[IO.Path]::PathSeparator+$env:PSModulePath
$install=Get-Content -LiteralPath $Plan -Raw | ConvertFrom-Json
$appDirectory=[IO.Path]::GetFullPath($install.appRoot).TrimEnd('\')
$workDirectory=[IO.Path]::GetFullPath($install.work).TrimEnd('\')
$stageDirectory=Join-Path $workDirectory 'extracted'
$resultFile=$install.resultFile
function Safe-Child([string]$Root,[string]$Relative) {
  if([IO.Path]::IsPathRooted($Relative) -or $Relative.Contains(':')){throw '更新路径必须是相对路径'}
  $resolved=[IO.Path]::GetFullPath((Join-Path $Root $Relative))
  if(-not $resolved.StartsWith($Root.TrimEnd('\')+'\',[StringComparison]::OrdinalIgnoreCase)){throw '更新文件超出目标目录'}
  return $resolved
}
function Validate-Package {
  $manifestFile=Join-Path $stageDirectory 'CS2 Cam/update-manifest.json'
  $manifest=Get-Content -LiteralPath $manifestFile -Raw -Encoding UTF8 | ConvertFrom-Json
  if($manifest.product -ne 'CS2 Cam' -or $manifest.version -ne $install.expectedVersion){throw '更新包的产品或版本不匹配'}
  $packageRoot=Join-Path $stageDirectory 'CS2 Cam'
  $seen=@{}
  foreach($entry in $manifest.files){
    $relative=$entry.path.Replace('/','\')
    if($relative -match '(^|\\)(data|uploads|avatars|pov-output|\.env|settings\.json)(\\|$)'){throw '更新包不得覆盖个人数据'}
    if($seen.ContainsKey($relative)){throw '更新包包含重复路径'};$seen[$relative]=$true
    $source=Safe-Child $packageRoot $relative
    $null=Safe-Child $appDirectory $relative
    if((Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash.ToLowerInvariant() -ne $entry.sha256){throw ('更新文件校验失败：'+$relative)}
  }
  if(-not $seen.ContainsKey('CS2 Cam.exe') -or -not $seen.ContainsKey('resources\app\package.json')){throw '更新包缺少程序文件'}
  return $manifest
}
if($PrepareOnly){
  if(Test-Path -LiteralPath $stageDirectory){throw '安装暂存目录已存在，请清理本次暂存目录后重试'}
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  $zip=[IO.Compression.ZipFile]::OpenRead($install.archive)
  try{foreach($entry in $zip.Entries){$null=Safe-Child $stageDirectory $entry.FullName}}finally{$zip.Dispose()}
  New-Item -ItemType Directory -Path $stageDirectory | Out-Null
  Expand-Archive -LiteralPath $install.archive -DestinationPath $stageDirectory
  $null=Validate-Package
  Write-Output 'Update package verified.'
  exit 0
}
$changes=[Collections.Generic.List[object]]::new()
$backupDirectory=Join-Path $workDirectory 'backup'
$success=$false;$message=''
try{
  $manifest=Validate-Package
  $deadline=[DateTime]::UtcNow.AddMinutes(2)
  do{
    $running=@(Get-CimInstance Win32_Process | Where-Object {$_.ExecutablePath -and $_.ExecutablePath.StartsWith($appDirectory+'\',[StringComparison]::OrdinalIgnoreCase)})
    if(-not $running.Count){break}
    if([DateTime]::UtcNow -gt $deadline){throw '软件或录制任务尚未退出，更新已取消'}
    Start-Sleep -Milliseconds 500
  }while($true)
  foreach($entry in $manifest.files){
    $target=Safe-Child $appDirectory $entry.path
    if((Test-Path -LiteralPath $target) -and (Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash.ToLowerInvariant() -eq $entry.sha256){continue}
    $saved=Safe-Child $backupDirectory $entry.path
    $existed=Test-Path -LiteralPath $target
    if($existed){New-Item -ItemType Directory -Force -Path (Split-Path $saved) | Out-Null;Copy-Item -LiteralPath $target -Destination $saved}
    $changes.Add(@{target=$target;saved=$saved;existed=$existed})
    New-Item -ItemType Directory -Force -Path (Split-Path $target) | Out-Null
    Copy-Item -LiteralPath (Safe-Child (Join-Path $stageDirectory 'CS2 Cam') $entry.path) -Destination $target -Force
  }
  Copy-Item -LiteralPath (Join-Path $stageDirectory 'CS2 Cam/update-manifest.json') -Destination (Join-Path $appDirectory 'update-manifest.json') -Force
  $success=$true;$message='更新完成'
}catch{
  $message=$_.Exception.Message
  for($index=$changes.Count-1;$index -ge 0;$index--){
    $change=$changes[$index]
    if($change.existed){Copy-Item -LiteralPath $change.saved -Destination $change.target -Force}
    elseif(Test-Path -LiteralPath $change.target){Remove-Item -LiteralPath $change.target}
  }
}finally{
  $result=@{success=$success;message=$message;version=$install.expectedVersion} | ConvertTo-Json
  [IO.File]::WriteAllText($resultFile,$result,[Text.UTF8Encoding]::new($false))
}
if(-not $NoRestart){
  $executable=Join-Path $appDirectory 'CS2 Cam.exe'
  if(Test-Path -LiteralPath $executable){Start-Process -FilePath $executable -WorkingDirectory $appDirectory -WindowStyle Hidden}
}
if(-not $success){throw $message}
