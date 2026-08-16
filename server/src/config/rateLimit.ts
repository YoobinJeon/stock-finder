import rateLimit, { type RateLimitRequestHandler } from 'express-rate-limit';

/**
 * 레이트리밋 설정 — 공개 노출 시 무차별 요청·무가드 heavy POST 남용을 막는다.
 * localhost·사설 오버레이망(CGNAT 100.64.0.0/10) 요청은 크론 자기호출·로컬 개발이라 제외.
 *
 * 주의: 이 skip이 실제로 동작하려면 app.ts에서 `trust proxy`가 설정돼 있어야 한다.
 * 리버스 프록시가 127.0.0.1로 프록시하는 구성에서는 trust proxy 없이 **공개 트래픽 전부가**
 * 로컬로 보여 리밋이 통째로 무력화된다.
 */

const WINDOW_MS = 60 * 1000;
const GLOBAL_MAX = 300; // 분당 전역 상한
const STRICT_MAX = 10; // 분당 강화 상한 (heavy POST·전체스캔 GET)

// 인증 실패 전용 상한 — 공개 노출 시 Basic Auth 비밀번호가 유일한 방어막이라
// 무제한 추측을 막는다. 성공 요청은 세지 않으므로(skipSuccessfulRequests) 정상 사용자는
// 걸리지 않는다. 신뢰 IP도 예외 없이 적용 — 프록시가 X-Forwarded-For를 붙이지 않아
// 공개 요청이 로컬로 보이는 경우에도 브루트포스가 막히도록.
const AUTH_WINDOW_MS = 15 * 60 * 1000;
const AUTH_MAX_FAILURES = 20;

/** 신뢰 IP(로컬·사설망)면 레이트리밋을 건너뛴다. */
export function isTrustedIp(ip: string | undefined): boolean {
  if (!ip) return false;
  // IPv6 매핑 접두어(::ffff:) 제거
  const v4 = ip.replace(/^::ffff:/, '');
  if (v4 === '127.0.0.1' || ip === '::1') return true;
  // 사설 오버레이망 CGNAT: 100.64.0.0 ~ 100.127.255.255
  const m = /^(\d{1,3})\.(\d{1,3})\./.exec(v4);
  if (m && Number(m[1]) === 100) {
    const second = Number(m[2]);
    if (second >= 64 && second <= 127) return true;
  }
  return false;
}

const skip = (req: { ip?: string }): boolean => isTrustedIp(req.ip);

/** 전역 리밋(모든 요청)·강화 리밋(heavy 엔드포인트)·인증 실패 리밋을 생성한다. */
export function createRateLimiters(): {
  global: RateLimitRequestHandler;
  strict: RateLimitRequestHandler;
  auth: RateLimitRequestHandler;
} {
  const global = rateLimit({
    windowMs: WINDOW_MS,
    limit: GLOBAL_MAX,
    standardHeaders: true,
    legacyHeaders: false,
    skip,
    message: { error: '요청이 너무 많습니다. 잠시 후 다시 시도하세요.' },
  });
  const strict = rateLimit({
    windowMs: WINDOW_MS,
    limit: STRICT_MAX,
    standardHeaders: true,
    legacyHeaders: false,
    skip,
    message: { error: '요청이 너무 많습니다. 잠시 후 다시 시도하세요.' },
  });
  // 인증 실패 리밋 — skip 없음(신뢰 IP도 적용), 성공 응답은 카운트하지 않는다.
  const auth = rateLimit({
    windowMs: AUTH_WINDOW_MS,
    limit: AUTH_MAX_FAILURES,
    standardHeaders: true,
    legacyHeaders: false,
    skipSuccessfulRequests: true,
    // "성공"을 401이 아닌 모든 응답으로 정의한다. 기본값(2xx/3xx만 성공)을 쓰면 평범한
    // 404·500 응답까지 카운트돼 정상 사용자가 앱 전체에서 잠기는 부작용이 생긴다.
    requestWasSuccessful: (_req, res) => res.statusCode !== 401,
    message: { error: '인증 시도가 너무 많습니다. 잠시 후 다시 시도하세요.' },
  });

  return { global, strict, auth };
}
