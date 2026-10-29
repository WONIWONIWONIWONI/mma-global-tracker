// 시간 상수와 KST(한국 시간) 날짜 경계 계산. 날짜는 KST 00시 기준이다.
export const MIN = 60e3, HOUR = 3600e3, DAY = 864e5, KST_OFFSET = 9 * HOUR;

// ts가 속한 KST 날짜의 00시(UTC 밀리초)
export const kstMidnight = ts => Math.floor((ts + KST_OFFSET) / DAY) * DAY - KST_OFFSET;
