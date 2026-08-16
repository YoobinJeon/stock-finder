/**
 * 첫 페인트 전 테마 적용 — 다크모드 사용자가 흰 화면을 잠깐 보는 현상(FOUC)을 막는다.
 *
 * index.html의 인라인 스크립트가 아니라 외부 파일인 이유: 서버가 CSP `script-src 'self'`를
 * 적용하기 때문(server/src/config/app.ts). 인라인 스크립트는 nonce/hash 없이는 차단된다.
 * src/shared/useTheme.ts의 STORAGE_KEY와 같은 'sf-theme' 키를 공유한다 — 한쪽만 바꾸면
 * 첫 페인트 깜빡임이 되살아난다.
 */
(function () {
  try {
    var t = localStorage.getItem('sf-theme');
    if (t === 'dark' || (!t && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
      document.documentElement.classList.add('dark');
    }
  } catch (e) {
    /* localStorage 접근 불가(프라이빗 모드 등) 시 라이트 유지 */
  }
})();
