// 데이터 출처. 기본은 같은 주소의 /api (Cloudflare Worker).
// 가짜 데이터: 주소 뒤에 ?mock 을 붙이거나, 미리보기 서버(포트 8000)에서 열면 브라우저 안의 가짜 API를 쓴다.
export const API_BASE = "/api";
export const USE_MOCK = new URLSearchParams(location.search).has("mock") || location.port === "8000";
export const REFRESH_MS = 60e3;   // 화면 자동 갱신 간격(백그라운드 탭에서는 멈춤)
