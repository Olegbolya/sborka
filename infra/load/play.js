// N-02 · нагрузочный тест плеера: 200 одновременных участников проходят опубликованные сборки.
// Запуск: k6 run -e BASE_URL=https://blokker.ru -e SLUGS=slug1,slug2,slug3 infra/load/play.js
// Каждый участник: открывает страницу → начинает прохождение → отвечает на каждый вопрос → сохраняет место → завершает.
import http from 'k6/http';
import { check, group, sleep } from 'k6';
import { Counter, Trend } from 'k6/metrics';

const BASE = (__ENV.BASE_URL || 'http://127.0.0.1:3100').replace(/\/$/, '');
const API = `${BASE}${__ENV.API_PREFIX || '/api/v1'}`;
const SLUGS = (__ENV.SLUGS || '').split(',').map((s) => s.trim()).filter(Boolean);
const VUS = Number(__ENV.VUS || 200);
const HOLD = __ENV.HOLD || '2m';
const RAMP = __ENV.RAMP || '30s';

const completed = new Counter('passages_completed');
const failed = new Counter('passages_failed');
const playerTime = new Trend('player_request_ms', true);

export const options = {
  scenarios: {
    participants: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: RAMP, target: VUS },
        { duration: HOLD, target: VUS },
        { duration: '10s', target: 0 },
      ],
      gracefulRampDown: '30s',
    },
  },
  thresholds: {
    // N-02: p95 < 300 мс для запросов плеера при 200 одновременных участниках.
    player_request_ms: ['p(95)<300'],
    http_req_failed: ['rate<0.01'],
    passages_failed: ['count==0'],
  },
};

const headers = { 'Content-Type': 'application/json', Origin: BASE, 'X-Blokum-CSRF': '1' };

function call(method, url, body, name) {
  const res = http.request(method, url, body === undefined ? null : JSON.stringify(body), { headers, tags: { name } });
  playerTime.add(res.timings.duration);
  return res;
}

export function setup() {
  if (SLUGS.length === 0) throw new Error('Не заданы сборки: -e SLUGS=адрес1,адрес2,адрес3');
  return {};
}

function answerFor(block) {
  if (block.type === 'singleChoice' || block.type === 'multiChoice') {
    const first = block.props.options[0];
    return first ? { kind: 'choice', optionIds: [first.id] } : null;
  }
  if (block.type === 'textInput') return { kind: 'text', value: block.props.mask === 'number' ? '7' : 'Нагрузочный ответ' };
  if (block.type === 'scale') return { kind: 'number', value: block.props.min };
  return null;
}

export default function () {
  // 3 эталонные сборки — участники делятся между ними поровну.
  const slug = SLUGS[(__VU - 1) % SLUGS.length];
  let ok = false;
  group('passage', () => {
    const view = call('GET', `${API}/play/${slug}`, undefined, 'GET /play/:slug');
    if (!check(view, { 'страница открылась': (r) => r.status === 200 })) return;
    const body = view.json();
    const doc = body.document;
    const projectId = body.projectId || body.id;
    if (!doc || !projectId) return;
    sleep(1 + Math.random() * 2);

    const started = call('POST', `${API}/play/${projectId}/sessions`, {}, 'POST /play/:id/sessions');
    if (!check(started, { 'прохождение началось': (r) => r.status === 201 })) return;
    const sid = started.json().sessionId;
    if (!sid) return;

    let seq = 0;
    for (const screen of doc.screens) {
      sleep(1 + Math.random() * 2);
      for (const block of screen.blocks) {
        const value = answerFor(block);
        if (!value) continue;
        const r = call('POST', `${API}/play/sessions/${sid}/answers`, { blockId: block.id, value, clientEventId: `k6-${__VU}-${__ITER}-${seq++}-${Date.now()}`, clientTs: Date.now() }, 'POST /play/sessions/:id/answers');
        if (!check(r, { 'ответ принят': (x) => x.status === 200 })) return;
      }
      const st = call('PUT', `${API}/play/sessions/${sid}/state`, { screenId: screen.id, history: [screen.id], variables: {} }, 'PUT /play/sessions/:id/state');
      if (!check(st, { 'место сохранено': (x) => x.status === 200 })) return;
    }
    const done = call('POST', `${API}/play/sessions/${sid}/complete`, {}, 'POST /play/sessions/:id/complete');
    ok = check(done, { 'прохождение завершено': (x) => x.status === 200 });
  });
  if (ok) completed.add(1);
  else failed.add(1);
  sleep(1);
}
