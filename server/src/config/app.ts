import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { logger } from '../utils/logger';
import { createRateLimiters } from './rateLimit';
import stocksRoutes from '../api/routes/stocks.routes';
import screenerRoutes from '../api/routes/screener.routes';
import scoringRoutes from '../api/routes/scoring.routes';
import marketRoutes from '../api/routes/market.routes';
import dataRoutes from '../api/routes/data.routes';
import signalsRoutes from '../api/routes/signals.routes';
import backtestRoutes from '../api/routes/backtest.routes';
import algorithmsRoutes from '../api/routes/algorithms.routes';
import watchlistRoutes from '../api/routes/watchlist.routes';
import etfRoutes from '../api/routes/etf.routes';
import themesRoutes from '../api/routes/themes.routes';
import calendarRoutes from '../api/routes/calendar.routes';
import turnoverRoutes from '../api/routes/turnover.routes';

/**
 * Basic Auth 비교용 다이제스트. 원문 길이가 달라도 다이제스트는 항상 32바이트라
 * timingSafeEqual에 그대로 넣을 수 있다 — 길이 사전 비교(=비밀번호 길이 누출)를 없애기 위함.
 */
function digest(v: string): Buffer {
  return crypto.createHash('sha256').update(v, 'utf8').digest();
}

export function createApp(): express.Application {
  const app = express();

  // 프록시 신뢰 범위 — 리버스 프록시가 127.0.0.1로 프록시하면 이 설정이 없을 때
  // 공개 트래픽의 req.ip가 전부 127.0.0.1이 되어 rateLimit.isTrustedIp가 참이 되고
  // 레이트리밋이 통째로 무력화된다. 'loopback'만 신뢰하므로
  // X-Forwarded-For를 위조해도 express는 오른쪽부터 훑어 첫 비신뢰 주소를 고른다.
  app.set('trust proxy', 'loopback');

  // 보안 헤더. CSP는 자체 번들만 쓰는 SPA라 'self' 기준으로 켠다 —
  // 인라인 스크립트는 client/public/theme-init.js로 분리했고 외부 CDN·폰트·이미지는 쓰지 않는다.
  // styleSrc에 'unsafe-inline'이 필요한 이유: React의 style={{...}} 속성이 인라인 스타일이라
  // 차트·프로그레스바 등 동적 크기 지정이 전부 막힌다.
  app.use(helmet({
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:'],
        fontSrc: ["'self'", 'data:'],
        connectSrc: ["'self'"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        frameAncestors: ["'none'"],
        formAction: ["'self'"],
        // upgrade-insecure-requests는 일부러 넣지 않는다 — http://<LAN IP>:4000 직접 접속이
        // 깨진다. 공개 경로는 리버스 프록시에서 HTTPS로 종단된다.
      },
    },
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
  }));

  // CORS (프로덕션 단일 프로세스 서빙 시에는 동일 오리진이라 사실상 미사용)
  const allowedOrigins = (process.env.ALLOWED_ORIGINS ?? 'http://localhost:5173').split(',');
  app.use(cors({ origin: allowedOrigins, methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] }));

  // Body 파싱
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true }));

  // 레이트리밋 — 전역(분당 300) + heavy 엔드포인트 강화(분당 10). 로컬·사설망은 skip.
  const { global: globalLimiter, strict: strictLimiter, auth: authLimiter } = createRateLimiters();
  app.use(globalLimiter);
  app.use('/api/v1/data', strictLimiter);
  app.use('/api/v1/market/rs', strictLimiter);
  app.use('/api/v1/screener', strictLimiter);
  // 스냅샷 적재는 전 ETF를 훑어 쓰는 heavy POST라 강화 리밋 대상
  app.use('/api/v1/etf/snapshot', strictLimiter);

  // 헬스체크
  app.get('/health', (_req, res) => res.json({ status: 'ok' }));

  // 접속 비밀번호 (선택): ACCESS_PASSWORD 설정 시 전체 앱에 Basic Auth 한 겹.
  // 공개 배포처럼 신뢰할 수 없는 네트워크에 노출할 때 켜는 용도 — 미설정이면 완전히 비활성.
  const accessPassword = process.env.ACCESS_PASSWORD;
  if (accessPassword) {
    const expected = digest(accessPassword);
    // 인증 실패 리밋을 인증 미들웨어보다 먼저 — 401을 받은 IP만 카운트되므로(401이 아닌 응답은
    // requestWasSuccessful로 성공 처리) 정상 사용자는 걸리지 않는다. 프록시가 X-Forwarded-For를
    // 붙이지 않아 공개 요청이 로컬로 보이더라도 이 리밋은 skip 없이 적용된다.
    app.use(authLimiter);
    app.use((req, res, next) => {
      const [scheme, cred] = (req.headers.authorization ?? '').split(' ');
      if (scheme === 'Basic' && cred) {
        // 다이제스트끼리 비교해 길이·내용 어느 쪽도 타이밍으로 새지 않게 한다.
        const supplied = digest(
          Buffer.from(cred, 'base64').toString().split(':').slice(1).join(':'),
        );
        if (crypto.timingSafeEqual(supplied, expected)) {
          next();
          return;
        }
      }
      res.set('WWW-Authenticate', 'Basic realm="Stock Finder"').status(401).send('접속 비밀번호가 필요합니다.');
    });
  } else {
    logger.warn('ACCESS_PASSWORD 미설정 — 인증 없이 전체 공개 상태. 신뢰할 수 없는 네트워크에 노출한다면 반드시 설정하세요.');
  }

  // API 라우트
  app.use('/api/v1/stocks',   stocksRoutes);
  app.use('/api/v1/screener', screenerRoutes);
  app.use('/api/v1/scoring',  scoringRoutes);
  app.use('/api/v1/market',   marketRoutes);
  app.use('/api/v1/data',     dataRoutes);
  app.use('/api/v1/signals',  signalsRoutes);
  app.use('/api/v1/backtest', backtestRoutes);
  app.use('/api/v1/algorithms', algorithmsRoutes);
  app.use('/api/v1/watchlist', watchlistRoutes);
  app.use('/api/v1/etf',      etfRoutes);
  app.use('/api/v1/themes',   themesRoutes);
  app.use('/api/v1/calendar', calendarRoutes);
  app.use('/api/v1/market/turnover', turnoverRoutes);

  // API 404
  app.use('/api', (_req, res) => res.status(404).json({ error: 'Not Found' }));

  // 빌드된 프론트엔드가 있으면 정적 서빙 + SPA 폴백 (단일 프로세스 배포)
  // NODE_ENV에 의존하지 않음 — 배포 플랫폼마다 환경변수 기본값이 달라서 존재 여부로 판단
  const clientDist = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '../../../client/dist',
  );
  if (fs.existsSync(clientDist)) {
    app.use(express.static(clientDist));
    app.get('*', (_req, res) => res.sendFile(path.join(clientDist, 'index.html')));
  }

  // 전역 에러 핸들러 — 스택은 **서버 로그에만** 남기고 클라이언트에는 일반 문구만 준다.
  // 이전에는 `NODE_ENV !== 'production'`이면 err.message를 응답에 실어 보냈는데,
  // 이 프로젝트의 실행 스크립트(dev·start·serve)는 어느 것도 NODE_ENV를 세팅하지 않는다 —
  // 즉 실제로는 **항상** 내부 메시지가 노출되는 상태였다. 원인 파악에는 아래 logger.error가
  // 스택까지 남기므로 충분하고, 그쪽이 응답 본문보다 안전하다.
  app.use((err: Error, req: express.Request, res: express.Response, _next: express.NextFunction) => {
    logger.error(`요청 처리 실패 ${req.method} ${req.originalUrl}`, err);
    if (res.headersSent) return;
    res.status(500).json({ error: 'Internal Server Error' });
  });

  return app;
}
