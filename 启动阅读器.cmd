@echo off
chcp 65001 >nul
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo 请先安装 Node.js 22.12 或更新的 LTS 版本。
  pause
  exit /b 1
)
if not exist "node_modules\.bin\vite.cmd" (
  echo 正在安装开发依赖，首次安装需要网络……
  call npm.cmd ci
  if errorlevel 1 goto failed
)
echo 正在准备本地阅读器……
call npm.cmd run build
if errorlevel 1 goto failed
echo 阅读器即将打开。请保持此窗口开启，按 Ctrl+C 停止。
call npm.cmd run preview -- --open
if errorlevel 1 goto failed
exit /b 0
:failed
echo 启动失败。请检查上面的错误信息；端口被占用时请关闭先前启动的阅读器。
pause
exit /b 1
