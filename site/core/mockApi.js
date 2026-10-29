// 가짜 API. 실제 API와 같은 응답을 브라우저 안에서 만든다(JSON으로 한 번 바꿔 실제 응답과 똑같이 맞춤).
import { fakeObservations } from "./fakeSource.js";
import { buildPayload } from "./api.js";

export function getPayload(now = Date.now()) {
  return JSON.parse(JSON.stringify(buildPayload(fakeObservations(now), now, { sample: true })));
}
