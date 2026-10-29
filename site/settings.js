// 데이터 출처. 기본은 같은 주소의 /api (Cloudflare Worker).
// 가짜 데이터: 주소 뒤에 ?mock 을 붙이거나, 미리보기 서버(포트 8000)에서 열면 브라우저 안의 가짜 API를 쓴다.
export const API_BASE = "/api";
const params = new URLSearchParams(location.search);
export const USE_MOCK = params.has("mock") || location.port === "8000";
export const REFRESH_MS = 60e3;        // 기본 갱신 간격. 실제 간격은 서버가 남은 요청 한도를 보고 늘릴 수 있다(최대 10분).
// 이 시간 동안 조작이 없으면 자동 갱신을 멈춘다(요청 한도 절약). 시험할 때는 주소에 ?idle=초 를 붙인다.
export const IDLE_MS = (Number(params.get("idle")) || 15 * 60) * 1000;
