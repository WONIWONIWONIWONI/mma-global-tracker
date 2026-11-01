// 화면을 통째로 갈아 끼우지 않고 바뀐 곳만 고친다.
// 브라우저 번역(크롬·구글 번역 등)은 글자 조각을 <font> 로 바꿔 번역문을 넣어 두는데, innerHTML 로 통째로 바꾸면
// 20초마다 한국어로 돌아갔다가 다시 번역되며 깜빡이고 화면이 밀린다. 그래서 지난번에 그린 내용(사본)과 이번 내용을
// 비교해, 달라진 글자·속성만 실제 화면에 반영한다. 안 바뀐 글자(안내문·제목 등)는 건드리지 않아 번역이 그대로 남는다.
const prev = new WeakMap();

export function patchHTML(el, html) {
  const t = document.createElement("template");
  t.innerHTML = html;
  const next = t.content, old = prev.get(el);
  prev.set(el, next.cloneNode(true));
  if (!old) { el.replaceChildren(next); return; }
  patchKids(el, old, next);
}

// 다른 코드가 직접 바꾼 요소(그래프 등)는 사본과 맞지 않으므로 다음에는 처음처럼 통째로 그리게 한다
export function forget(el) { prev.delete(el); }

function patchKids(live, o, n) {
  const oc = o.childNodes, nc = n.childNodes;
  // 실제 화면의 자식 수가 사본과 다르면(번역기가 구조를 바꿨거나 다른 코드가 고침) 이 부분만 통째로 바꾼다
  if (live.childNodes.length !== oc.length) { live.replaceChildren(...[...nc].map(c => c.cloneNode(true))); return; }
  for (let i = 0; i < nc.length; i++) {
    const a = oc[i], b = nc[i], l = live.childNodes[i];
    if (!a) { live.appendChild(b.cloneNode(true)); continue; }
    if (a.nodeType !== b.nodeType || a.nodeName !== b.nodeName) { live.replaceChild(b.cloneNode(true), l); continue; }
    if (b.nodeType === 3) {
      // 글자: 바뀐 경우에만 고친다(번역기가 <font> 로 바꿔 둔 자리는 새 글자로 교체)
      if (a.nodeValue !== b.nodeValue) { if (l.nodeType === 3) l.nodeValue = b.nodeValue; else live.replaceChild(b.cloneNode(true), l); }
      continue;
    }
    if (b.nodeType !== 1 || a.isEqualNode(b)) continue;
    if (l.nodeType !== 1 || l.nodeName !== b.nodeName) { live.replaceChild(b.cloneNode(true), l); continue; }
    syncAttrs(l, a, b);
    patchKids(l, a, b);
  }
  for (let i = live.childNodes.length - 1; i >= nc.length; i--) live.removeChild(live.childNodes[i]);
}

function syncAttrs(l, a, b) {
  for (const { name, value } of b.attributes) if (a.getAttribute(name) !== value) l.setAttribute(name, value);
  for (const { name } of a.attributes) if (!b.hasAttribute(name)) l.removeAttribute(name);
  // 고른 값이 속성으로 바뀐 선택 상자는 화면 값도 맞춘다
  if (b.nodeName === "OPTION" && b.hasAttribute("selected") !== a.hasAttribute("selected")) l.selected = b.hasAttribute("selected");
}
