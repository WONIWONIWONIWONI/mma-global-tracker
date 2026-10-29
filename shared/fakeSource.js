// 가짜 관측 데이터. 투표 주소가 공개되기 전에 화면과 계산을 확인하는 용도.
// 이틀 전 12:00(KST)에 투표가 시작된 것으로 가정하고, 사이트마다 1분 간격 관측을 만든다.
import { CANDIDATES } from "./config.js";
import { MIN, HOUR, DAY, KST_OFFSET, kstMidnight } from "./time.js";

const SETUP = {
  melon: { lag: 2000, seed: 11, rates: [820, 860, 300, 520, 610, 450, 480, 400, 280, 380, 350, 330, 300, 260, 290, 310, 420, 360, 270, 240] },
  berriz: { lag: 7000, seed: 29, rates: [95, 10, 8, 22, 40, 70, 66, 88, 6, 12, 18, 9, 20, 72, 80, 14, 25, 15, 34, 7] }
};

function rng(seed) {
  return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}
// 밤 10시 무렵 투표가 몰리고 새벽에 줄어드는 하루 흐름
const diurnal = ts => { const h = ((ts + KST_OFFSET) / HOUR) % 24; return 0.35 + 0.65 * (0.5 + 0.5 * Math.cos((h - 22) / 24 * 2 * Math.PI)); };

let state = null;

function record(s) {
  const candidates = {};
  CANDIDATES.forEach((c, k) => { candidates[c.id] = s.cum[k]; });
  s.obs.push({ source: s.key, observedAt: state.start + s.i * MIN + s.lag, sourceAt: null, totalVotes: s.cum.reduce((a, b) => a + b, 0), candidates });
}

function step(s) {
  s.i++;
  const ts = state.start + (s.i - 1) * MIN, di = diurnal(ts);
  for (let k = 0; k < CANDIDATES.length; k++) {
    if (s.burst[k] > 0) s.burst[k]--; else if (s.r() < 0.0006) s.burst[k] = 15 + Math.floor(s.r() * 30);
    const drift = 1 + 0.22 * Math.sin(s.i / (240 + k * 31) + s.phase[k]);
    s.cum[k] += Math.round(s.rates[k] * di * drift * (s.burst[k] > 0 ? 2.6 : 1) * (0.75 + 0.5 * s.r()));
  }
  record(s);
}

export function fakeObservations(now) {
  if (!state) {
    state = { start: kstMidnight(now) - 2 * DAY + 12 * HOUR, sites: {} };
    for (const [key, cfg] of Object.entries(SETUP)) {
      const r = rng(cfg.seed);
      const s = { key, lag: cfg.lag, rates: cfg.rates, r, i: 0, obs: [],
        cum: CANDIDATES.map(() => 0), burst: CANDIDATES.map(() => 0), phase: CANDIDATES.map(() => r() * 6.283) };
      state.sites[key] = s;
      record(s);
    }
  }
  for (const s of Object.values(state.sites)) while (state.start + (s.i + 1) * MIN + s.lag <= now) step(s);
  return { melon: state.sites.melon.obs, berriz: state.sites.berriz.obs };
}
