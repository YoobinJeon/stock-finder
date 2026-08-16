import axios from 'axios';
import { unzipSync } from 'fflate';
import iconv from 'iconv-lite';
import { logger } from '../../utils/logger';

/**
 * DART 공시 원문 조회 — document.xml API는 ZIP(내부 XML 1개)을 반환한다.
 * 정상 응답은 ZIP 바이너리, 오류 응답은 JSON({status, message})이므로 응답 바디로 판별한다.
 */
const DOCUMENT_URL = 'https://opendart.fss.or.kr/api/document.xml';

const EUC_KR_RE = /encoding\s*=\s*["'](euc-kr|ks_c_5601(-1987)?)["']/i;

/** ZIP 매직 바이트(PK\x03\x04) 여부 — JSON 에러 응답과 구분 */
function isZip(buf: Buffer): boolean {
  return buf.length >= 4 && buf[0] === 0x50 && buf[1] === 0x4b && buf[2] === 0x03 && buf[3] === 0x04;
}

function decodeXml(raw: Uint8Array): string {
  // 인코딩 선언은 ASCII 범위이므로 우선 latin1로 가볍게 훑어 판별한다.
  const head = Buffer.from(raw.subarray(0, 200)).toString('latin1');
  const isEucKr = EUC_KR_RE.test(head);
  return isEucKr ? iconv.decode(Buffer.from(raw), 'euc-kr') : Buffer.from(raw).toString('utf-8');
}

/** XML/HTML 태그를 제거하고 공백을 정리한 평문 텍스트로 변환 */
function stripTags(xml: string): string {
  return xml
    .replace(/<!\[CDATA\[|\]\]>/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** DART 공시 원문(document.xml)을 평문 텍스트로 반환한다 — 오류·ZIP 아님이면 null. */
export async function fetchDartDocumentText(apiKey: string, rceptNo: string): Promise<string | null> {
  try {
    const { data } = await axios.get(DOCUMENT_URL, {
      params: { crtfc_key: apiKey, rcept_no: rceptNo },
      timeout: 15000,
      responseType: 'arraybuffer',
    });
    const buf = Buffer.from(data);

    if (!isZip(buf)) {
      let message = '';
      try {
        message = JSON.parse(buf.toString('utf-8'))?.message ?? '';
      } catch {
        message = buf.slice(0, 100).toString('utf-8');
      }
      logger.warn(`DART 원문 조회 실패 (rcept_no=${rceptNo}): ${message}`);
      return null;
    }

    const entries = unzipSync(buf);
    const xmlName = Object.keys(entries).find((name) => name.toLowerCase().endsWith('.xml'));
    if (!xmlName) {
      logger.warn(`DART 원문 ZIP에 XML 없음 (rcept_no=${rceptNo})`);
      return null;
    }

    const xml = decodeXml(entries[xmlName]);
    return stripTags(xml);
  } catch (e: any) {
    logger.warn(`DART 원문 조회 오류 (rcept_no=${rceptNo}): ${e?.message}`);
    return null;
  }
}
