param([Parameter(Mandatory=$true)][string]$Task,[Parameter(Mandatory=$true)][string]$Output)
$ErrorActionPreference='Stop'
$root=Resolve-Path (Join-Path $PSScriptRoot '..')
$python=$env:CS2_PYTHON
if(!$python){$python=Join-Path $root '..\.venv312\Scripts\python.exe'}
if(!(Test-Path $python)){ $python=(Get-Command python.exe -ErrorAction Stop).Source }
$worker=Join-Path $root 'record_worker.py'
& $python $worker --task $Task --output $Output
exit $LASTEXITCODE
