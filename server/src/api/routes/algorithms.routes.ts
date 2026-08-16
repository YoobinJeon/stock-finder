import { Router, Request, Response } from 'express';
import { getDb } from '../../config/database';
import { registry } from '../../scoring/AlgorithmRegistry';
import { asyncHandler } from '../../utils/asyncHandler';

const router = Router();

// 전체 알고리즘 목록 — 코드(엔진 메타)와 DB 설정을 병합해 반환
router.get('/', asyncHandler(async (_req: Request, res: Response) => {
  const { rows } = await getDb().query(
    'SELECT id, name, category, version, enabled, weight, params, updated_at FROM algorithm_configs',
  );
  const configMap = Object.fromEntries(rows.map((r) => [r.id, r]));

  const list = registry.getAll().map((engine) => {
    const cfg = configMap[engine.meta.id];
    return {
      id: engine.meta.id,
      name: engine.meta.name,
      category: engine.meta.category,
      version: engine.meta.version,
      description: engine.meta.description,
      enabled: cfg ? Boolean(cfg.enabled) : engine.meta.enabled,
      weight: cfg ? Number(cfg.weight) : engine.meta.weight,
      params: cfg ? cfg.params : engine.meta.params,
      updated_at: cfg?.updated_at ?? null,
    };
  });
  res.json(list);
}));

// 가중치/활성화 수정 — 저장 후 rescore를 돌려야 저장된 점수에 반영됨
router.put('/:id', asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  const engine = registry.get(id);
  if (!engine) {
    res.status(404).json({ error: `알 수 없는 알고리즘: ${id}` });
    return;
  }

  const { enabled, weight } = req.body ?? {};
  if (typeof enabled !== 'boolean' || typeof weight !== 'number' || weight < 0 || weight > 1) {
    res.status(400).json({ error: 'enabled(boolean), weight(0~1 number)가 필요합니다.' });
    return;
  }

  await getDb().query(
    `INSERT INTO algorithm_configs (id, name, category, version, enabled, weight, params)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (id) DO UPDATE
       SET enabled = EXCLUDED.enabled, weight = EXCLUDED.weight, updated_at = NOW()`,
    [id, engine.meta.name, engine.meta.category, engine.meta.version,
     enabled, weight, JSON.stringify(engine.meta.params)],
  );
  res.json({ id, enabled, weight });
}));

export default router;
