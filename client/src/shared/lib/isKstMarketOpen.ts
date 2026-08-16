/** 한국 장 개장(평일 09:00~15:40 KST) 여부. 서버 kstMarket()과 동일 기준. */
export function isKstMarketOpen(): boolean {
  const kst = new Date(Date.now() + 9 * 3600 * 1000);
  const dow = kst.getUTCDay();
  const mins = kst.getUTCHours() * 60 + kst.getUTCMinutes();
  return dow >= 1 && dow <= 5 && mins >= 9 * 60 && mins <= 15 * 60 + 40;
}
