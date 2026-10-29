@echo off
rem 트래커 화면을 가짜 데이터로 내 컴퓨터에서 미리 보기. 창을 닫으면 멈춥니다.
cd /d "%~dp0"
start "" http://localhost:8000/
python -m http.server 8000 --bind 127.0.0.1 --directory site
