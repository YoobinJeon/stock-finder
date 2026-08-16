/**
 * TTL 캐시 + single-flight 유틸 — 여러 라우트/소스에 흩어진 `{data, at}` + `Date.now()-at>ttl`
 * 패턴을 하나로. 만료 시 동시 요청이 무거운 계산을 각자 돌리지 않고 in-flight 하나를 공유한다.
 */
export interface TtlCache<T> {
  /** 캐시가 신선하면 그대로, 아니면 loader를 1회만 실행(동시요청 공유)해 갱신 후 반환 */
  get(): Promise<T>;
  /** 강제 무효화 (다음 get에서 재계산) */
  clear(): void;
}

export function createTtlCache<T>(ttlMs: number, loader: () => Promise<T>): TtlCache<T> {
  let cached: { data: T; at: number } | null = null;
  let inflight: Promise<T> | null = null;

  return {
    async get(): Promise<T> {
      if (cached && Date.now() - cached.at < ttlMs) return cached.data;
      if (!inflight) {
        inflight = loader()
          .then((data) => {
            cached = { data, at: Date.now() };
            return data;
          })
          .finally(() => { inflight = null; });
      }
      return inflight;
    },
    clear() {
      cached = null;
    },
  };
}

/** 키별 TTL 캐시 — 키 개수에 상한이 있고, 초과하면 가장 오래 안 쓰인 키부터 버린다(LRU). */
export interface KeyedTtlCache<T> {
  get(key: string): Promise<T>;
  /** 현재 보관 중인 키 개수 (테스트·진단용) */
  size(): number;
}

/**
 * 티커처럼 외부 입력이 그대로 키가 되는 캐시를 위한 LRU 상한 래퍼.
 *
 * 상한이 필요한 이유: 종목코드는 `[0-9A-Z]{6}` 형식 검증만 통과하면 되므로 조합이 21억 개다.
 * 존재하지 않는 코드로도 항목이 먼저 만들어지는 구조(loader 실행 전 등록)라, 무작위 코드로
 * 반복 요청하면 Map이 무한히 커져 메모리가 고갈된다 (2026-07-26 전체 리뷰에서 발견).
 *
 * loader가 throw하면 그 키는 캐시에 남기지 않는다 — 일시 장애가 TTL 동안 "데이터 없음"으로
 * 고착되지 않도록(기존 createTtlCache의 fail-soft 계약과 동일).
 */
export function createKeyedTtlCache<T>(
  ttlMs: number,
  maxKeys: number,
  loaderFor: (key: string) => () => Promise<T>,
): KeyedTtlCache<T> {
  // Map은 삽입 순서를 보존한다 — 접근할 때마다 delete 후 재삽입하면 맨 뒤가 최신이고
  // keys().next()가 가장 오래된 키가 되어 별도 자료구조 없이 LRU가 된다.
  const entries = new Map<string, TtlCache<T>>();

  return {
    async get(key: string): Promise<T> {
      let cache = entries.get(key);
      if (cache) {
        entries.delete(key); // 최근 사용으로 갱신
      } else {
        cache = createTtlCache(ttlMs, loaderFor(key));
      }
      entries.set(key, cache);

      while (entries.size > maxKeys) {
        const oldest = entries.keys().next();
        if (oldest.done) break;
        entries.delete(oldest.value);
      }

      try {
        return await cache.get();
      } catch (e) {
        // 실패한 키는 자리를 차지하지 않게 즉시 제거 (무효 티커 폭주로 캐시가 오염되는 것 방지)
        entries.delete(key);
        throw e;
      }
    },
    size: () => entries.size,
  };
}
