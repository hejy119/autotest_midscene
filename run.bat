@echo off
chcp 65001 >nul
cd /d %~dp0
title AI 自动化测试框架

rem 检查 node 是否可用（便携版 node 可自行把目录加进 PATH）
where node >nul 2>nul
if errorlevel 1 (
  echo 未找到 node，请先安装 Node.js 并加入 PATH。
  pause
  exit /b 1
)

rem 国内网络下避免截图等字体加载超时（Playwright 原生变量，.env 里也可配）
set "PW_TEST_SCREENSHOT_NO_FONTS_READY=1"

node node_modules\tsx\dist\cli.mjs src\index.ts
pause
