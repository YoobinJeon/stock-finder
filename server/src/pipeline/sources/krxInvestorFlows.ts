import axios from 'axios';
import { sleep } from '../http';
import { logger } from '../../utils/logger';

/**
 * KRX 정보데이터시스템 — 투자자별 순매수상위종목 [12010] (MDCSTAT02401).
 * 세부 주체(연기금·투신·사모 등)별 종목 순매수 대금. 로그인 필수(KRX_ID/KRX_PW).
 * 로그인 플로우는 pykrx auth.py와 동일: warmup GET×2 → POST 로그인(CD001 성공,
 * CD011 중복 로그인 → skipDup=Y 재시도).
 */
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const LOGIN_PAGE = 'https://data.krx.co.kr/contents/MDC/COMS/client/MDCCOMS001.cmd';
const LOGIN_JSP = 'https://data.krx.co.kr/contents/MDC/COMS/client/view/login.jsp?site=mdc';
const LOGIN_URL = 'https://data.krx.co.kr/contents/MDC/COMS/client/MDCCOMS001D1.cmd';
const DATA_URL = 'https://data.krx.co.kr/comm/bldAttendant/getJsonData.cmd';

export const KRX_INVESTORS: Record<string, string> = {
  '금융투자': '1000',
  '보험': '2000',
  '투신': '3000',
  '사모': '3100',
  '은행': '4000',
  '연기금': '6000',
  '기관합계': '7050',  // 공식 금액 — stock_flows.inst_amt 덮어쓰기용
  '외국인': '9000',    // 공식 금액 — stock_flows.foreign_amt 덮어쓰기용
  '개인': '8000',      // 공식 금액 — stock_flows.individual_amt (기본 수급 순위용)
};

export interface KrxNetPurchase {
  ticker: string;
  name: string;
  netAmt: number; // 순매수 거래대금 (원)
  netQty: number; // 순매수 수량 (주)
  buyAmt: number; // 매수 거래대금 (원, BID — 당일평단 키움 매칭용)
  buyQty: number; // 매수 거래수량 (주, BID — 당일평단 키움 매칭용)
}

class KrxSession {
  private cookies = new Map<string, string>();
  private loggedInAt = 0;
  private keysLogged = false; // 필드명 검증용 — 첫 응답 첫 행만 1회 로그

  private mergeCookies(setCookie: string[] | undefined): void {
    for (const c of setCookie ?? []) {
      const [pair] = c.split(';');
      const eq = pair.indexOf('=');
      if (eq > 0) this.cookies.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
    }
  }

  private cookieHeader(): string {
    return [...this.cookies.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
  }

  isValid(): boolean {
    return this.loggedInAt > 0 && Date.now() - this.loggedInAt < 50 * 60 * 1000; // 50분
  }

  async login(): Promise<void> {
    const id = process.env.KRX_ID;
    const pw = process.env.KRX_PW;
    if (!id || !pw) throw new Error('KRX_ID/KRX_PW 미설정');

    this.cookies.clear();
    const r1 = await axios.get(LOGIN_PAGE, { headers: { 'User-Agent': UA }, timeout: 15000 });
    this.mergeCookies(r1.headers['set-cookie']);
    const r2 = await axios.get(LOGIN_JSP, {
      headers: { 'User-Agent': UA, Referer: LOGIN_PAGE, Cookie: this.cookieHeader() },
      timeout: 15000,
    });
    this.mergeCookies(r2.headers['set-cookie']);

    const form: Record<string, string> = { mbrNm: '', telNo: '', di: '', certType: '', mbrId: id, pw };
    let data = await this.postLogin(form);
    if (data?._error_code === 'CD011') {
      data = await this.postLogin({ ...form, skipDup: 'Y' });
    }
    if (data?._error_code !== 'CD001') {
      throw new Error(`KRX 로그인 실패: ${data?._error_code} ${data?._error_message ?? ''}`);
    }
    this.loggedInAt = Date.now();
    logger.info('KRX 로그인 성공 (세부 투자자 수급 수집)');
  }

  private async postLogin(form: Record<string, string>) {
    const resp = await axios.post(LOGIN_URL, new URLSearchParams(form).toString(), {
      headers: {
        'User-Agent': UA,
        Referer: LOGIN_PAGE,
        'Content-Type': 'application/x-www-form-urlencoded',
        Cookie: this.cookieHeader(),
      },
      timeout: 15000,
    });
    this.mergeCookies(resp.headers['set-cookie']);
    return resp.data;
  }

  async fetchNetPurchases(dateYmd: string, mktId: 'STK' | 'KSQ', invstTpCd: string): Promise<KrxNetPurchase[]> {
    if (!this.isValid()) await this.login();
    const body = new URLSearchParams({
      bld: 'dbms/MDC/STAT/standard/MDCSTAT02401',
      strtDd: dateYmd,
      endDd: dateYmd,
      mktId,
      invstTpCd,
    }).toString();
    const { data } = await axios.post(DATA_URL, body, {
      headers: {
        'User-Agent': UA,
        Referer: 'https://data.krx.co.kr/contents/MDC/MDI/outerLoader/index.cmd',
        'X-Requested-With': 'XMLHttpRequest',
        'Content-Type': 'application/x-www-form-urlencoded',
        Cookie: this.cookieHeader(),
      },
      timeout: 20000,
    });
    if (typeof data === 'string') throw new Error(`KRX 응답 이상 (세션 만료?): ${String(data).slice(0, 30)}`);

    const output: any[] = data?.output ?? [];
    if (!this.keysLogged && output.length > 0) {
      // 필드명 검증용 — BID_TRDVAL/BID_TRDVOL 실제 존재 여부를 최초 1회만 확인 (수급 당일평단 정밀화)
      logger.info('[KRX keys] ' + Object.keys(output[0]).join(','));
      this.keysLogged = true;
    }

    return output
      .map((r: any) => ({
        ticker: String(r.ISU_SRT_CD ?? '').trim(),
        name: String(r.ISU_NM ?? '').trim(),
        netAmt: Number(String(r.NETBID_TRDVAL ?? '0').replace(/,/g, '')),
        // 필드명이 응답 버전에 따라 다를 수 있어 안전하게 폴백 (수급 추정평균가 정확화)
        netQty: Number(String(r.NETBID_TRDVOL ?? r.NETBID_TRD_VOLUME ?? '0').replace(/,/g, '')),
        // 매수(BID)측 대금·수량 — 당일평단을 키움과 정확히 맞추기 위함 (수급 당일평단 정밀화)
        buyAmt: Number(String(r.BID_TRDVAL ?? '0').replace(/,/g, '')),
        buyQty: Number(String(r.BID_TRDVOL ?? '0').replace(/,/g, '')),
      }))
      .filter(
        (r: KrxNetPurchase) =>
          /^\d{6}$/.test(r.ticker) &&
          Number.isFinite(r.netAmt) &&
          Number.isFinite(r.netQty) &&
          Number.isFinite(r.buyAmt) &&
          Number.isFinite(r.buyQty),
      );
  }
}

export const krxSession = new KrxSession();

export function krxConfigured(): boolean {
  return Boolean(process.env.KRX_ID && process.env.KRX_PW);
}

/** 특정 거래일의 전 세부주체 × 양시장 수급 수집. 반환: 저장할 행 목록 */
export async function fetchDetailFlowsForDate(
  dateYmd: string,
): Promise<Array<{ ticker: string; investor: string; netAmt: number; netQty: number; buyAmt: number; buyQty: number }>> {
  const rows: Array<{ ticker: string; investor: string; netAmt: number; netQty: number; buyAmt: number; buyQty: number }> = [];
  for (const [investor, code] of Object.entries(KRX_INVESTORS)) {
    for (const mkt of ['STK', 'KSQ'] as const) {
      const list = await krxSession.fetchNetPurchases(dateYmd, mkt, code);
      for (const r of list)
        rows.push({ ticker: r.ticker, investor, netAmt: r.netAmt, netQty: r.netQty, buyAmt: r.buyAmt, buyQty: r.buyQty });
      await sleep(400); // politeness
    }
  }
  return rows;
}
