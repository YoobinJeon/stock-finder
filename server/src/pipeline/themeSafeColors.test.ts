import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

/**
 * 다크 테마에서 글씨가 사라지는 색 조합을 막는 회귀 테스트.
 *
 * 이 프로젝트는 Tailwind 팔레트를 `client/src/index.css`의 `--sf-*` CSS 변수로 **재정의**하고,
 * 다크 테마에서 그 값을 뒤집는다(`bg-*-100`은 어두워지고 `text-*-700`은 밝아진다).
 * 그런데 **재정의 목록에 없는 명암**(`-800`, `indigo` 전체 등)을 쓰면 Tailwind 기본값(어두운 색)이
 * 그대로 남아, 다크 테마에서 **어두운 배경 + 어두운 글씨**가 되어 배지가 통째로 안 보인다.
 *
 * 눈으로만 확인해서는 놓치기 쉬운 종류의 회귀라 자동 검사로 고정한다.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const clientSrc = path.resolve(here, '../../../client/src');
const cssPath = path.join(clientSrc, 'index.css');

/** 검사 대상 — 배지·칩이 몰려 있는 화면과 공용 컴포넌트. 넓히려면 여기에 추가한다. */
const TARGET_DIRS = [path.join(clientSrc, 'pages', 'screener')];
const TARGET_FILES = [
  path.join(clientSrc, 'shared', 'lib', 'scoreGrade.ts'),
  path.join(clientSrc, 'shared', 'components', 'MarketIndicatorGrid.tsx'),
  path.join(clientSrc, 'shared', 'components', 'StockChipList.tsx'),
  path.join(clientSrc, 'shared', 'components', 'SectorMembers.tsx'),
];

/** 재정의 대상 색군 — gray처럼 전 명암이 정의된 것도 포함해 일관되게 검사한다. */
const THEMED_COLORS = [
  'gray', 'blue', 'red', 'amber', 'emerald', 'rose', 'sky', 'green',
  'yellow', 'purple', 'pink', 'orange', 'indigo',
];

const CLASS_RE = new RegExp(
  `\\b(?:bg|text|border)-(${THEMED_COLORS.join('|')})-(\\d{2,3})\\b`,
  'g',
);

/** index.css가 실제로 정의한 (색, 명암) 집합. */
function definedShades(): Set<string> {
  const css = fs.readFileSync(cssPath, 'utf-8');
  const out = new Set<string>();
  for (const m of css.matchAll(/--sf-([a-z]+)-(\d{2,3})\s*:/g)) {
    out.add(`${m[1]}-${m[2]}`);
  }
  return out;
}

function collectFiles(): string[] {
  const files = [...TARGET_FILES];
  for (const dir of TARGET_DIRS) {
    if (!fs.existsSync(dir)) continue;
    for (const name of fs.readdirSync(dir)) {
      if (name.endsWith('.ts') || name.endsWith('.tsx')) files.push(path.join(dir, name));
    }
  }
  return files.filter((f) => fs.existsSync(f));
}

test('index.css가 테마 변수를 정의하고 있다 — 검사 전제', () => {
  const shades = definedShades();
  assert.ok(shades.size > 20, `--sf-* 변수를 찾지 못했습니다 (${cssPath})`);
  assert.ok(shades.has('emerald-100'), 'emerald-100은 재정의돼 있어야 합니다');
});

test('검사 대상 화면·공용 컴포넌트는 테마가 재정의한 명암만 쓴다 — 다크 테마에서 글씨가 사라지지 않도록', () => {
  const shades = definedShades();
  const violations: string[] = [];

  for (const file of collectFiles()) {
    const text = fs.readFileSync(file, 'utf-8');
    for (const m of text.matchAll(CLASS_RE)) {
      const key = `${m[1]}-${m[2]}`;
      if (!shades.has(key)) {
        violations.push(`${path.basename(file)}: ${m[0]} (--sf-${key} 미정의)`);
      }
    }
  }

  assert.deepEqual(
    violations,
    [],
    `테마에 없는 색 명암을 썼습니다 — 다크 테마에서 배경과 글씨가 같은 톤이 됩니다:\n  ${violations.join('\n  ')}`,
  );
});
