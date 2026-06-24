# deploy.ps1 — Envia as alterações para o GitHub e dispara o deploy automático no Render
# USO: clique com botão direito no arquivo > "Run with PowerShell"
#      OU abra o PowerShell na pasta do projeto e execute: .\deploy.ps1

$ErrorActionPreference = "Stop"
$ProjectDir = Split-Path -Parent $MyInvocation.MyCommand.Path

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  DEPLOY — P. Soluções Esportes CRM" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

Set-Location $ProjectDir

# Verificar se há alterações
$status = git status --porcelain
if (-not $status) {
    Write-Host "Nenhuma alteração para enviar." -ForegroundColor Yellow
    Read-Host "Pressione Enter para sair"
    exit 0
}

# Mostrar arquivos alterados
Write-Host "Arquivos alterados:" -ForegroundColor White
git status --short
Write-Host ""

# Solicitar mensagem de commit
$msg = Read-Host "Mensagem do commit (Enter = 'update')"
if (-not $msg) { $msg = "update" }

Write-Host ""
Write-Host "-> git add ." -ForegroundColor DarkGray
git add .

Write-Host "-> git commit: $msg" -ForegroundColor DarkGray
git commit -m $msg

Write-Host "-> git push origin main" -ForegroundColor DarkGray
git push origin main

Write-Host ""
Write-Host "Deploy enviado com sucesso!" -ForegroundColor Green
Write-Host "Acompanhe em: https://dashboard.render.com" -ForegroundColor Cyan
Write-Host ""
Read-Host "Pressione Enter para sair"
