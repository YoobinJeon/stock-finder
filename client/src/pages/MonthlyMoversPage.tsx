import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { apiClient } from '../shared/api/client';
import { API } from '../shared/api/endpoints';
import { StockDetailPanel } from '../shared/components/StockDetailPanel';
import { GroupMatrix } from './monthly/GroupMatrix';
import { MonthRanking } from './monthly/MonthRanking';
import { AXIS_LABEL, type Axis, type MonthlyGroupsResponse } from './monthly/monthlyTypes';

type Tab = 'matrix' | 'ranking';

const STOCK_LIMITS = [30, 50, 100, 200] as const;

interface SelectedStock {
  ticker: string;
  name: string;
  market: string | null;
}

/**
 * 월간 상승률 — 월간으로 많이 오른 테마·산업과 종목을 본다.
 *
 * 수익률은 **월말 종가 대비 월말 종가**이고, 2026-01부터 시작해 달이 지날 때마다 열이 하나씩
 * 늘어난다. 적재 테이블 없이 `stock_prices`에서 매번 계산하므로 누적이 저절로 이뤄진다.
 *
 * 행을 묶는 축은 **테마(다대다)와 산업(일대다)** 두 가지다 — 테마는 겹치는 시선이고 산업은
 * 전 종목을 겹침 없이 가른다. 탭·축·달 선택은 URL에 남는다 — 링크를 그대로 공유·재방문할 수 있게.
 */
export function MonthlyMoversPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const tab: Tab = searchParams.get('tab') === 'ranking' ? 'ranking' : 'matrix';
  const axis: Axis = searchParams.get('axis') === 'sector' ? 'sector' : 'theme';
  const [stockLimit, setStockLimit] = useState<number>(50);
  const [selected, setSelected] = useState<SelectedStock | null>(null);

  const { data, isLoading, isError } = useQuery<MonthlyGroupsResponse>({
    queryKey: ['market', 'monthly', 'groups', axis],
    queryFn: () => apiClient
      .get(API.market.monthlyGroups, { params: { axis } })
      .then((r) => r.data),
  });

  const months = data?.months ?? [];
  const monthParam = searchParams.get('month');
  const month = monthParam && months.includes(monthParam)
    ? monthParam
    : months[months.length - 1] ?? '';

  const setParams = (next: { tab?: Tab; axis?: Axis; month?: string }) => {
    const params: Record<string, string> = {
      tab: next.tab ?? tab,
      axis: next.axis ?? axis,
    };
    const m = next.month ?? monthParam;
    if (m) params.month = m;
    setSearchParams(params);
  };

  const excluded = data?.excludedByMonth?.[month] ?? 0;

  return (
    <div className="p-6 space-y-4">
      <header className="space-y-1">
        <h1 className="text-xl font-bold text-gray-900">📅 월간 상승률</h1>
        <p className="text-sm text-gray-500">
          달마다 많이 오른 <b>테마·산업과 종목</b>을 봅니다. 수익률은 <b>직전 달 마지막 거래일 종가
          대비 그 달 마지막 거래일 종가</b>이며, {data?.startMonth ?? '2026-01'}부터 달이 지날
          때마다 쌓입니다.
        </p>
      </header>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 bg-surface rounded-xl border border-gray-200 p-4">
        <div className="flex items-center gap-1.5">
          {([['matrix', '매트릭스'], ['ranking', '월 랭킹']] as const).map(([v, label]) => (
            <button
              key={v}
              onClick={() => setParams({ tab: v })}
              aria-pressed={tab === v}
              className={`text-xs rounded-full px-3 py-1.5 border font-medium ${
                tab === v
                  ? 'bg-[#111827] text-white border-[#111827]'
                  : 'bg-surface text-gray-600 border-gray-200 hover:bg-gray-50'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {/* 축 — 테마는 겹치는 시선, 산업은 전 종목을 겹침 없이 가른다. 두 탭 모두에 적용된다. */}
        <div className="flex items-center gap-2 text-sm">
          <span className="text-gray-500">묶음</span>
          <div className="flex items-center gap-1.5">
            {(['theme', 'sector'] as const).map((v) => (
              <button
                key={v}
                onClick={() => setParams({ axis: v })}
                aria-pressed={axis === v}
                className={`text-xs rounded-full px-3 py-1.5 border font-medium ${
                  axis === v
                    ? 'bg-blue-50 text-blue-700 border-blue-300'
                    : 'bg-surface text-gray-600 border-gray-200 hover:bg-gray-50'
                }`}
              >
                {AXIS_LABEL[v]}
              </button>
            ))}
          </div>
        </div>

        {tab === 'ranking' && months.length > 0 && (
          <>
            <label className="flex items-center gap-2 text-sm">
              <span className="text-gray-500">달</span>
              <select
                value={month}
                onChange={(e) => setParams({ month: e.target.value })}
                className="text-sm rounded-lg border border-gray-200 bg-surface px-2 py-1.5 text-gray-900"
              >
                {[...months].reverse().map((m) => (
                  <option key={m} value={m}>
                    {m}{m === data?.partialMonth ? ' (진행 중)' : ''}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-2 text-sm">
              <span className="text-gray-500">종목</span>
              <select
                value={stockLimit}
                onChange={(e) => setStockLimit(Number(e.target.value))}
                className="text-sm rounded-lg border border-gray-200 bg-surface px-2 py-1.5 text-gray-900"
              >
                {STOCK_LIMITS.map((n) => <option key={n} value={n}>상위 {n}</option>)}
              </select>
            </label>
          </>
        )}

        {data && (
          <span className="ml-auto text-xs text-gray-400">
            시세 기준 {data.asOf}
            {data.partialMonth && ` · ${data.partialMonth}는 진행 중`}
          </span>
        )}
      </div>

      {isLoading && <p className="text-sm text-gray-400">불러오는 중…</p>}
      {isError && <p className="text-sm text-red-500">월간 상승률을 불러오지 못했습니다.</p>}

      {data && tab === 'matrix' && (
        // key로 축을 물려 축을 바꾸면 펼침·정렬 상태가 초기화되게 한다 — 테마에서 펼쳐 둔 행 키가
        // 산업 축에 남아 있어 봐야 맞는 행이 없다.
        <GroupMatrix key={axis} data={data} onSelectStock={setSelected} />
      )}
      {data && tab === 'ranking' && month && (
        <MonthRanking
          groups={data}
          month={month}
          stockLimit={stockLimit}
          onSelectStock={setSelected}
        />
      )}

      <div className="text-xs text-gray-400 leading-relaxed space-y-1">
        <p>
          {AXIS_LABEL[axis]} 칸은 <b>멤버 종목 수익률의 중앙값</b>입니다(마우스를 올리면 평균·상승
          비율·분모가 보입니다). 평균이 아니라 중앙값을 쓰는 이유는 멤버 수 편차가 커서, 잡주
          하나가 크게 뛰면 평균이 통째로 끌려가기 때문입니다. 값을 가진 멤버가 2종목 미만인 달은
          비워 둡니다.
        </p>
        <p>
          {axis === 'theme' ? (
            <>
              <b>테마</b>는 겹치는 시선입니다 — 한 종목이 여러 테마에 들어가고 테마끼리도 겹칩니다.
              겹침 없이 전 종목을 가른 그림은 <b>산업</b>으로 바꿔서 보십시오.
            </>
          ) : (
            <>
              <b>산업</b>은 종목마다 하나씩 붙은 분류라 행이 겹치지 않고 전 종목이 한 번씩만
              들어갑니다. <b>산업 분류가 없는 종목은 미분류로 묶지 않고 뺍니다</b> — 그 행의
              중앙값은 어떤 산업도 대표하지 않기 때문입니다.
            </>
          )}
        </p>
        <p>
          ⚠️ <b>{AXIS_LABEL[axis]} 구성에는 시점 정보가 없습니다.</b> 과거 달도 <b>오늘 구성</b>으로
          소급 계산되며, 그달 상장 전이었던 종목은 값이 없어 빠집니다. 배당은 반영하지 않은 가격
          수익률이고, 액면분할·병합은 반영합니다. 종목 랭킹에는 시총·품질 필터가 없고 상장폐지
          종목만 뺍니다.
        </p>
        {excluded > 0 && (
          <p>
            {month}은 <b>{excluded}종목</b>을 제외했습니다 — 액면병합·감자가 소급 반영되지 않아
            하루 만에 종가가 몇 배로 튄 종목이며, 그 값은 수익률이 아니라 눈금 변화입니다.
          </p>
        )}
      </div>

      {selected && (
        <StockDetailPanel
          ticker={selected.ticker}
          name={selected.name}
          market={selected.market ?? ''}
          sector=""
          totalScore={null}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  );
}
