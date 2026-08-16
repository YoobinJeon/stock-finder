import axios from 'axios';
import iconv from 'iconv-lite';
import { getDb } from '../config/database';
import { logger } from '../utils/logger';

/**
 * 수집한 지수·수급 데이터로 시장 색깔(market regime)을 계산한다. 장중에도 갱신된다.
 *
 * breadth·지수: 네이버 지수 페이지(전체 시장 실시간 상승/하락 종목수) — 장중 반영.
 *   실패 시 stock_prices(보유 종가) 기반으로 폴백.
 * 투자자 순매수: stock_flows_krx(KRX 세부수급, 확정치) — 장중엔 아직 없어 null일 수 있음.
 */

/** 장중 재계산 스로틀 — GET /regime 폴링이 잦아도 90초에 1번만 실제 계산 */
let lastComputeAt = 0;
const THROTTLE_MS = 90 * 1000;

/** 현재 KST가 장중(평일 09:00~15:40)인지 + KST 오늘 날짜(YYYY-MM-DD) */
function kstNow(): { open: boolean; today: string; hhmm: string } {
  const kst = new Date(Date.now() + 9 * 3600 * 1000);
  const dow = kst.getUTCDay(); // 0=일 6=토
  const mins = kst.getUTCHours() * 60 + kst.getUTCMinutes();
  const open = dow >= 1 && dow <= 5 && mins >= 9 * 60 && mins <= 15 * 60 + 40;
  return {
    open,
    today: kst.toISOString().slice(0, 10),
    hhmm: kst.toISOString().slice(11, 16),
  };
}

interface Breadth { close: number | null; chgPct: number | null; up: number | null; down: number | null; }

/** 네이버 지수 페이지에서 실시간 지수·등락·상승/하락 종목수 */
async function fetchNaverBreadth(code: 'KOSPI' | 'KOSDAQ'): Promise<Breadth | null> {
  try {
    const res = await axios.get(`https://finance.naver.com/sise/sise_index.naver?code=${code}`, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      responseType: 'arraybuffer',
      timeout: 8000,
    });
    const t = iconv.decode(Buffer.from(res.data), 'euc-kr');
    const num = (re: RegExp) => {
      const m = t.match(re);
      return m ? Number(m[1].replace(/,/g, '')) : null;
    };
    const close = num(/id="now_value">([\d,.]+)<\/em>/);
    const chgM = t.match(/id="change_value_and_rate"><span>[\d,.]+<\/span>\s*([+\-]?[\d.]+)%/);
    const up = num(/<span class="blind">상승종목수<\/span><a[^>]*><span>([\d,]+)<\/span>/);
    const down = num(/<span class="blind">하락종목수<\/span><a[^>]*><span>([\d,]+)<\/span>/);
    if (close == null || up == null || down == null) return null;
    return { close, chgPct: chgM ? Number(chgM[1]) : null, up, down };
  } catch {
    return null;
  }
}

/** 폴백: 보유 시세로 breadth 계산 (기준일 종가 vs 직전 거래일, 커버리지 70%+ 완료세션만) */
async function breadthFromPrices(): Promise<{ date: string; kospi: Breadth; kosdaq: Breadth } | null> {
  const db = getDb();
  const { rows: dRows } = await db.query(
    `WITH cnt AS (
       SELECT trade_date, COUNT(*) AS n FROM stock_prices
       WHERE trade_date >= CURRENT_DATE - INTERVAL '12 days' GROUP BY trade_date
     )
     SELECT to_char(trade_date, 'YYYY-MM-DD') AS d FROM cnt
     WHERE n >= (SELECT MAX(n) * 0.7 FROM cnt) ORDER BY trade_date DESC LIMIT 1`,
  );
  const date: string | null = dRows[0]?.d ?? null;
  if (!date) return null;
  const { rows } = await db.query(
    `WITH latest AS (SELECT ticker, close FROM stock_prices WHERE trade_date = $1),
     prev AS (
       SELECT p.ticker, p.close FROM stock_prices p
       JOIN (SELECT ticker, MAX(trade_date) AS d FROM stock_prices WHERE trade_date < $1 GROUP BY ticker) m
         ON m.ticker = p.ticker AND m.d = p.trade_date
     )
     SELECT s.market,
            COUNT(*) FILTER (WHERE l.close > pr.close)::int AS up,
            COUNT(*) FILTER (WHERE l.close < pr.close)::int AS down
     FROM latest l JOIN prev pr ON pr.ticker = l.ticker JOIN stocks s ON s.ticker = l.ticker
     WHERE s.is_active = TRUE AND s.market IN ('KOSPI','KOSDAQ') GROUP BY s.market`,
    [date],
  );
  const of = (mkt: string): Breadth => {
    const r = rows.find((x) => x.market === mkt);
    return { close: null, chgPct: null, up: r?.up ?? null, down: r?.down ?? null };
  };
  return { date, kospi: of('KOSPI'), kosdaq: of('KOSDAQ') };
}

export async function computeMarketRegime(): Promise<string | null> {
  const db = getDb();
  const { open, today, hhmm } = kstNow();

  // breadth·지수: 네이버 실시간 우선
  let kospi: Breadth | null = null;
  let kosdaq: Breadth | null = null;
  let refDate: string;
  let intraday = false;

  const [nk, nq] = await Promise.all([fetchNaverBreadth('KOSPI'), fetchNaverBreadth('KOSDAQ')]);
  if (nk && nk.up != null) {
    kospi = nk;
    kosdaq = nq ?? { close: null, chgPct: null, up: null, down: null };
    // 장중이면 오늘, 마감 후면 보유 최신 거래일(네이버는 마감 후에도 당일 최종치를 보여줌)
    if (open) { refDate = today; intraday = true; }
    else {
      const { rows } = await db.query(`SELECT to_char(MAX(trade_date),'YYYY-MM-DD') AS d FROM stock_prices`);
      refDate = rows[0]?.d ?? today;
    }
  } else {
    const fb = await breadthFromPrices();
    if (!fb) return null;
    kospi = fb.kospi; kosdaq = fb.kosdaq; refDate = fb.date;
  }

  // 투자자 순매수 (KRX 확정치, 억원) — 장중엔 아직 없을 수 있음
  const { rows: flows } = await db.query(
    `SELECT s.market, f.investor, ROUND(SUM(f.net_amt) / 1e8)::bigint AS bn
     FROM stock_flows_krx f JOIN stocks s ON s.ticker = f.ticker
     WHERE f.trade_date = $1 AND f.investor IN ('외국인','기관합계') AND s.market IN ('KOSPI','KOSDAQ')
     GROUP BY s.market, f.investor`,
    [refDate],
  );
  const flowOf = (m: string, inv: string) => flows.find((r) => r.market === m && r.investor === inv)?.bn ?? null;

  const kUp = kospi.up;
  const kDown = kospi.down;

  // 순환매 신호 (breadth 기반 단순 규칙 — 당일 스냅샷 판정)
  let signal = '⬜';
  let label = '데이터 부족';
  if (kUp != null && kDown != null && kUp + kDown > 0) {
    const advPct = (kUp / (kUp + kDown)) * 100;
    const kChg = kospi.chgPct ?? 0;
    if (kChg < 0 && advPct < 45)  { signal = '🟥'; label = '광범위 하락 (하락 우위)'; }
    else if (advPct >= 55)        { signal = '🟨'; label = '분산 — 폭넓은 참여 (순환매 국면)'; }
    else                          { signal = '🟦'; label = '쏠림 — 소수 주도/혼조'; }
  }
  const note = intraday ? `장중 ${hhmm} · ${signal} ${label}` : `${signal} ${label}`;

  await db.query(
    `INSERT INTO market_regime
       (date, kospi_close, kospi_chg, kospi_up, kospi_down, kosdaq_chg,
        ks_foreign_bn, ks_inst_bn, kq_foreign_bn, rotation_signal, note)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
     ON CONFLICT (date) DO UPDATE SET
       kospi_close=EXCLUDED.kospi_close, kospi_chg=EXCLUDED.kospi_chg,
       kospi_up=EXCLUDED.kospi_up, kospi_down=EXCLUDED.kospi_down,
       kosdaq_chg=EXCLUDED.kosdaq_chg,
       ks_foreign_bn=COALESCE(EXCLUDED.ks_foreign_bn, market_regime.ks_foreign_bn),
       ks_inst_bn=COALESCE(EXCLUDED.ks_inst_bn, market_regime.ks_inst_bn),
       kq_foreign_bn=COALESCE(EXCLUDED.kq_foreign_bn, market_regime.kq_foreign_bn),
       rotation_signal=EXCLUDED.rotation_signal, note=EXCLUDED.note`,
    [refDate, kospi.close, kospi.chgPct, kUp, kDown, kosdaq.chgPct,
     flowOf('KOSPI', '외국인'), flowOf('KOSPI', '기관합계'), flowOf('KOSDAQ', '외국인'), signal, note],
  );

  // 장중 계산이 남긴 미래 일자 행 정리 (기준일이 뒤로 밀린 경우)
  await db.query(`DELETE FROM market_regime WHERE date > $1`, [refDate]);
  lastComputeAt = Date.now();
  logger.info(`시장 색깔 계산 (${refDate}${intraday ? ` 장중 ${hhmm}` : ''}): ${signal} · 상승 ${kUp}/하락 ${kDown}`);
  return refDate;
}

/** GET /regime 폴링용 — 장중이면 스로틀 한도 내에서 재계산 후 반환 */
export async function refreshRegimeIfDue(): Promise<void> {
  const { open } = kstNow();
  if (!open) return;
  if (Date.now() - lastComputeAt < THROTTLE_MS) return;
  try { await computeMarketRegime(); } catch (e: any) { logger.warn(`장중 시장색깔 갱신 실패: ${e?.message}`); }
}
