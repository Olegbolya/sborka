// D-20 · нагрузочный тест табло: 50 открытых табло опрашивают общий ответ раз в 4 секунды.
// Запуск: k6 run -e BASE_URL=https://blokker.ru -e CODES=код1,код2 infra/load/board.js
import http from 'k6/http';
import { check, sleep } from 'k6';

const BASE = (__ENV.BASE_URL || 'http://127.0.0.1:3100').replace(/\/$/, '');
const API = `${BASE}${__ENV.API_PREFIX || '/api/v1'}`;
const CODES = (__ENV.CODES || '').split(',').map((s) => s.trim()).filter(Boolean);
const VUS = Number(__ENV.VUS || 50);
const DURATION = __ENV.DURATION || '2m';

export const options = {
  scenarios: { boards: { executor: 'constant-vus', vus: VUS, duration: DURATION } },
  thresholds: { http_req_duration: ['p(95)<300'], http_req_failed: ['rate<0.01'] },
};

export function setup() {
  if (CODES.length === 0) throw new Error('Укажите адреса табло: -e CODES=код1,код2');
}

export default function () {
  const code = CODES[(__VU - 1) % CODES.length];
  const res = http.get(`${API}/board/${code}`);
  check(res, { 'табло отвечает': (r) => r.status === 200 });
  sleep(4);
}
