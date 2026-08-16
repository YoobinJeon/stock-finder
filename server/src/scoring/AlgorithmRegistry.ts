import { AlgorithmEngine } from './engines/base/AlgorithmEngine';
import { getDb } from '../config/database';
import { logger } from '../utils/logger';

class AlgorithmRegistry {
  private engines = new Map<string, AlgorithmEngine>();

  register(engine: AlgorithmEngine): void {
    this.engines.set(engine.meta.id, engine);
    logger.debug(`Algorithm registered: ${engine.meta.id}`);
  }

  unregister(id: string): void {
    this.engines.delete(id);
  }

  get(id: string): AlgorithmEngine | undefined {
    return this.engines.get(id);
  }

  getAll(): AlgorithmEngine[] {
    return [...this.engines.values()];
  }

  /** DB의 enabled/weight/params 설정을 반영하여 활성 엔진만 반환 */
  async getActive(): Promise<AlgorithmEngine[]> {
    try {
      const { rows } = await getDb().query(
        'SELECT id, enabled, weight, params FROM algorithm_configs',
      );
      const configMap = Object.fromEntries(rows.map((r) => [r.id, r]));

      return [...this.engines.values()].filter((engine) => {
        const config = configMap[engine.meta.id];
        if (!config) return engine.meta.enabled;
        // DB 설정으로 런타임 오버라이드
        engine.meta.enabled = config.enabled;
        engine.meta.weight = Number(config.weight);
        Object.assign(engine.meta.params, config.params);
        return config.enabled;
      });
    } catch {
      // DB 연결 실패 시 메모리 설정 사용
      return [...this.engines.values()].filter((e) => e.meta.enabled);
    }
  }
}

export const registry = new AlgorithmRegistry();
