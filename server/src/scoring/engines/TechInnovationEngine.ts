import { AlgorithmEngine, AlgorithmMeta, StockData, MarketContext, EngineScore } from './base/AlgorithmEngine';

const TECH_KEYWORDS: Record<string, number> = {
  'AI': 10, '인공지능': 10, 'LLM': 10, '생성형': 9,
  'HBM': 10, '반도체': 8, 'NPU': 9, 'GAA': 9,
  'mRNA': 9, '유전자편집': 9, '바이오': 7,
  '전고체': 10, '수소': 7, 'SMR': 8,
  '휴머노이드': 9, '로봇': 8, '자율주행': 8,
  '위성': 8, '저궤도': 9, '우주': 7,
  '클라우드': 7, '보안': 6, '메타버스': 6,
  '전기차': 7, '이차전지': 8, '2차전지': 8,
};

/**
 * 업종(섹터) 기본 점수 — 부분 문자열 매칭, 순서대로 첫 매칭 적용.
 * 네이버 실제 업종명('반도체와반도체장비', '생물공학' 등)에 맞춘 키.
 */
const TECH_SECTORS: Array<[string, number]> = [
  ['반도체', 65], ['소프트웨어', 62], ['IT서비스', 58], ['디스플레이', 55],
  ['생물공학', 62], ['제약', 55], ['생명과학', 55], ['바이오', 60],
  ['우주항공과국방', 60], ['전자장비', 55], ['통신장비', 55], ['하드웨어', 55],
  ['양방향미디어', 55], ['인터넷', 55], ['게임', 52],
  ['전기제품', 52], ['이차전지', 60], ['핸드셋', 50], ['건강관리', 50],
  ['화학', 40], ['자동차', 40], ['기계', 38], ['에너지', 35], ['조선', 38],
  ['증권', 30], ['은행', 28], ['보험', 28], ['건설', 28],
  ['유통', 30], ['식품', 28], ['음료', 28], ['섬유', 28],
];

/** 순수 계산: 종목명·업종(문자열)만으로 기술 혁신 점수 산출 — DB/외부 조회 없음 */
export function scoreTechInnovation(name: string | undefined, sector: string | undefined): EngineScore {
  const sectorValue = sector ?? '';
  const text = `${name ?? ''} ${sectorValue}`;
  const reasons: string[] = [];

  // 업종 기본 점수
  let base = 25;
  let matchedSector: string | null = null;
  for (const [key, val] of TECH_SECTORS) {
    if (text.includes(key)) {
      base = val;
      matchedSector = key;
      break;
    }
  }
  if (sectorValue) {
    if (matchedSector && base >= 50) {
      reasons.push(`업종 '${sectorValue}' — 기술 관련 섹터 (기본 ${base}점)`);
    } else if (matchedSector) {
      reasons.push(`업종 '${sectorValue}' — 전통 산업 (기본 ${base}점)`);
    } else {
      reasons.push(`업종 '${sectorValue}' — 분류 외 (기본 ${base}점)`);
    }
  } else {
    reasons.push(`업종 정보 없음 (기본 ${base}점)`);
  }

  // 키워드 매칭 보너스 (최대 +40)
  const matched: string[] = [];
  let kwBonus = 0;
  for (const [kw, pts] of Object.entries(TECH_KEYWORDS)) {
    if (text.includes(kw)) {
      matched.push(`${kw}(+${pts})`);
      kwBonus += pts;
    }
  }
  kwBonus = Math.min(40, kwBonus);
  if (matched.length > 0) {
    reasons.push(`기술 키워드 매칭: ${matched.join(', ')} → 보너스 +${kwBonus}`);
  } else {
    reasons.push('기술 트렌드 키워드 매칭 없음');
  }

  return { score: Math.min(100, base + kwBonus), reasons };
}

export class TechInnovationEngine extends AlgorithmEngine {
  readonly meta: AlgorithmMeta = {
    id: 'tech_innovation_v1',
    name: '신기술 혁신',
    version: '2.1',
    category: 'tech_innovation',
    description: '종목명·업종 기반 기술 혁신 트렌드 점수',
    enabled: true,
    weight: 0.10,
    params: { keywordMax: 40 },
  };

  async calculate(stock: StockData, _ctx: MarketContext): Promise<EngineScore> {
    return scoreTechInnovation(stock.name, stock.sector);
  }
}
