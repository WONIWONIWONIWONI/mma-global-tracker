@echo off
rem 최종 결과 화면을 내 컴퓨터에서 미리 보기(site/history 기록 파일 사용). 창을 닫으면 멈춥니다.
cd /d "%~dp0"
start "" http://localhost:8000/
python -m http.server 8000 --bind 127.0.0.1 --directory site
