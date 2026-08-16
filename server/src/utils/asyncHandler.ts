import type { NextFunction, Request, RequestHandler, Response } from 'express';

/**
 * Express 4는 async 핸들러의 rejected promise를 에러 미들웨어로 전달하지
 * 않으므로(요청이 응답 없이 매달림), 모든 async 라우트는 이 래퍼로 감싼다.
 */
export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>,
): RequestHandler {
  return (req, res, next) => {
    fn(req, res, next).catch(next);
  };
}
