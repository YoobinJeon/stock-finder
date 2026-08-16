import { useEffect, useMemo, useState } from 'react';
import { useEscapeKey } from '../../shared/lib/useEscapeKey';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../../shared/api/client';
import { API } from '../../shared/api/endpoints';

interface BoardEntry {
  ticker: string;
  group: string;
}

interface BoardConfigResponse {
  defaults: BoardEntry[];
  added: BoardEntry[];
  removed: string[];
}

interface EtfListItem {
  ticker: string;
  name: string;
}

interface EtfListResponse {
  items: EtfListItem[];
}

interface EffectiveEntry extends BoardEntry {
  isDefault: boolean;
}

const MAX_ADDED = 30;
const MIN_BOARD_SIZE = 1;
const SEARCH_RESULT_LIMIT = 10;
const GROUP_OPTIONS = ['시장', '업종', '테마', '해외·원자재', '커스텀'];
const DEFAULT_GROUP = '커스텀';

/** 기본 큐레이션 + 로컬 편집분(added/removed)을 병합한 실효 목록 — 서버 mergeBoardList와 동일 규칙 */
function mergeLocal(defaults: BoardEntry[], added: BoardEntry[], removed: string[]): EffectiveEntry[] {
  const removedSet = new Set(removed);
  const addedTickerSet = new Set(added.map((a) => a.ticker));
  const kept = defaults
    .filter((d) => !removedSet.has(d.ticker) && !addedTickerSet.has(d.ticker))
    .map((d) => ({ ...d, isDefault: true }));
  const addedTagged = added.map((a) => ({ ...a, isDefault: false }));
  return [...kept, ...addedTagged];
}

function SearchResultRow({
  item, onAdd, disabled,
}: {
  item: EtfListItem;
  onAdd: (item: EtfListItem) => void;
  disabled: boolean;
}) {
  return (
    <li className="flex items-center justify-between gap-2 px-2 py-1.5 text-sm hover:bg-gray-50 rounded">
      <span className="truncate">
        <span className="font-medium text-gray-900">{item.name}</span>
        <span className="ml-1.5 text-xs text-gray-400">{item.ticker}</span>
      </span>
      <button
        onClick={() => onAdd(item)}
        disabled={disabled}
        className="shrink-0 text-xs rounded px-2 py-1 bg-blue-50 text-blue-600 border border-blue-100 hover:bg-blue-100 disabled:opacity-40"
      >
        + 추가
      </button>
    </li>
  );
}

function ConfigEntryChip({
  entry, name, onRemove, disabled,
}: {
  entry: EffectiveEntry;
  name: string;
  onRemove: (entry: EffectiveEntry) => void;
  disabled: boolean;
}) {
  return (
    <span className="inline-flex items-center gap-1 text-xs bg-gray-50 border border-gray-200 rounded-full pl-2.5 pr-1 py-1">
      {!entry.isDefault && <span className="text-blue-500">＋</span>}
      <span className="text-gray-800">{name}</span>
      <button
        onClick={() => onRemove(entry)}
        disabled={disabled}
        title={disabled ? '최소 1종은 남아 있어야 합니다' : '제거'}
        className="w-4 h-4 rounded-full flex items-center justify-center text-gray-400 hover:bg-gray-200 hover:text-gray-700 disabled:opacity-30 disabled:hover:bg-transparent"
      >
        ×
      </button>
    </span>
  );
}

/**
 * ETF 차트보드 커스텀 구성 패널 — 기본 큐레이션 31종에 대한 오버레이(added/removed)를
 * 편집해 PUT /etf/board-config로 저장한다. 기본 큐레이션 자체는 건드리지 않음.
 */
export function BoardConfigPanel({ onClose }: { onClose: () => void }) {
  useEscapeKey(onClose);
  const qc = useQueryClient();

  const { data, isLoading } = useQuery<BoardConfigResponse>({
    queryKey: ['etf', 'board-config'],
    queryFn: () => apiClient.get(API.etf.boardConfig).then((r) => r.data),
  });

  const { data: allEtf } = useQuery<EtfListResponse>({
    queryKey: ['etf', 'all'],
    queryFn: () => apiClient.get(API.etf.list).then((r) => r.data),
    staleTime: 5 * 60 * 1000,
  });

  const [added, setAdded] = useState<BoardEntry[]>([]);
  const [removed, setRemoved] = useState<string[]>([]);
  const [initialized, setInitialized] = useState(false);
  const [search, setSearch] = useState('');
  const [groupChoice, setGroupChoice] = useState(DEFAULT_GROUP);

  // 서버 구성 최초 로드 시 1회만 로컬 편집 상태 초기화 — 이후 로컬 편집을 덮어쓰지 않음
  useEffect(() => {
    if (data && !initialized) {
      setAdded(data.added);
      setRemoved(data.removed);
      setInitialized(true);
    }
  }, [data, initialized]);

  const nameByTicker = useMemo(
    () => new Map((allEtf?.items ?? []).map((i) => [i.ticker, i.name])),
    [allEtf],
  );

  const defaults = data?.defaults ?? [];
  const effective = useMemo(() => mergeLocal(defaults, added, removed), [defaults, added, removed]);
  const effectiveTickers = useMemo(() => new Set(effective.map((e) => e.ticker)), [effective]);
  const removeGuard = effective.length <= MIN_BOARD_SIZE;

  const searchResults = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q || !allEtf) return [];
    return allEtf.items
      .filter((i) => i.name.toLowerCase().includes(q) || i.ticker.includes(q))
      .slice(0, SEARCH_RESULT_LIMIT);
  }, [search, allEtf]);

  const save = useMutation({
    mutationFn: (config: { added: BoardEntry[]; removed: string[] }) =>
      apiClient.put(API.etf.boardConfig, config),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['etf', 'board'] });
      qc.invalidateQueries({ queryKey: ['etf', 'board-config'] });
      onClose();
    },
  });

  const errorMessage = (save.error as { response?: { data?: { error?: string } } } | undefined)
    ?.response?.data?.error ?? '저장에 실패했습니다.';

  function handleAdd(item: EtfListItem) {
    if (effectiveTickers.has(item.ticker) || added.length >= MAX_ADDED) return;
    setAdded((prev) => [...prev, { ticker: item.ticker, group: groupChoice }]);
    setSearch('');
  }

  function handleRemove(entry: EffectiveEntry) {
    if (removeGuard) return;
    if (entry.isDefault) {
      setRemoved((prev) => [...prev, entry.ticker]);
    } else {
      setAdded((prev) => prev.filter((a) => a.ticker !== entry.ticker));
    }
  }

  function handleRestoreDefaults() {
    setAdded([]);
    setRemoved([]);
    save.mutate({ added: [], removed: [] });
  }

  function handleSave() {
    save.mutate({ added, removed });
  }

  const groups = [...new Set(effective.map((e) => e.group))];

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/30" onClick={onClose}>
      <div
        className="bg-surface w-full sm:max-w-xl sm:rounded-2xl rounded-t-2xl max-h-[90vh] overflow-y-auto shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 bg-surface border-b border-gray-100 px-5 py-4 flex items-center gap-2">
          <h3 className="text-lg font-bold text-gray-900">⚙️ 차트보드 구성</h3>
          <button onClick={onClose} className="ml-auto text-gray-400 hover:text-gray-700 text-sm">닫기 ✕</button>
        </div>

        <div className="p-5 space-y-5">
          {isLoading && <p className="text-sm text-gray-400">불러오는 중…</p>}

          {!isLoading && (
            <>
              {/* 종목 추가 */}
              <div>
                <h4 className="text-sm font-semibold text-gray-900 mb-2">종목 추가</h4>
                <div className="flex gap-2">
                  <input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="종목명 또는 티커 검색"
                    className="flex-1 border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  <select
                    value={groupChoice}
                    onChange={(e) => setGroupChoice(e.target.value)}
                    className="border border-gray-300 rounded-lg px-2 py-1.5 text-sm"
                  >
                    {GROUP_OPTIONS.map((g) => <option key={g} value={g}>{g}</option>)}
                  </select>
                </div>
                {added.length >= MAX_ADDED && (
                  <p className="text-xs text-amber-600 mt-1.5">추가 종목은 최대 {MAX_ADDED}개까지 가능합니다.</p>
                )}
                {searchResults.length > 0 && (
                  <ul className="mt-2 border border-gray-100 rounded-lg divide-y divide-gray-50 max-h-56 overflow-y-auto">
                    {searchResults.map((item) => (
                      <SearchResultRow
                        key={item.ticker}
                        item={item}
                        onAdd={handleAdd}
                        disabled={effectiveTickers.has(item.ticker) || added.length >= MAX_ADDED}
                      />
                    ))}
                  </ul>
                )}
                {search.trim() && searchResults.length === 0 && (
                  <p className="text-xs text-gray-400 mt-1.5">검색 결과가 없습니다.</p>
                )}
              </div>

              {/* 현재 구성 */}
              <div>
                <h4 className="text-sm font-semibold text-gray-900 mb-2">
                  현재 구성 ({effective.length}종)
                </h4>
                {removeGuard && (
                  <p className="text-xs text-amber-600 mb-2">최소 1종은 차트보드에 남아 있어야 합니다.</p>
                )}
                <div className="space-y-3">
                  {groups.map((group) => (
                    <div key={group}>
                      <p className="text-xs font-medium text-gray-500 mb-1.5">{group}</p>
                      <div className="flex flex-wrap gap-1.5">
                        {effective.filter((e) => e.group === group).map((entry) => (
                          <ConfigEntryChip
                            key={entry.ticker}
                            entry={entry}
                            name={nameByTicker.get(entry.ticker) ?? entry.ticker}
                            onRemove={handleRemove}
                            disabled={removeGuard}
                          />
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {save.isError && <p className="text-xs text-red-500">{errorMessage}</p>}
            </>
          )}
        </div>

        <div className="sticky bottom-0 bg-surface border-t border-gray-100 px-5 py-3 flex items-center gap-3">
          <button
            onClick={handleRestoreDefaults}
            disabled={save.isPending}
            className="px-4 py-2 text-sm text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-40"
          >
            기본값 복원
          </button>
          <button
            onClick={handleSave}
            disabled={save.isPending || isLoading}
            className="ml-auto px-5 py-2 bg-[#111827] text-white text-sm font-medium rounded-lg hover:bg-gray-800 disabled:opacity-40"
          >
            {save.isPending ? '저장 중…' : '저장'}
          </button>
        </div>
      </div>
    </div>
  );
}
