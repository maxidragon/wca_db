import { useMemo } from "react";
import { formatDate, formatResult } from "../../utils/results";
import { CompetitionLink, EmptyMessage, SegmentedControl } from "./components";
import type { PersonResult, ResultGrouping, ResultsState } from "./types";

const GROUPING_OPTIONS = [
  { value: "event", label: "By event" },
  { value: "competition", label: "By competition" },
] as const;

/** Cutoff rounds share a name with the round they stand for. */
const ROUND_NAMES: Record<string, string> = {
  "0": "Qualification",
  h: "Qualification",
  "1": "First round",
  d: "First round",
  "2": "Second round",
  e: "Second round",
  "3": "Semi final",
  g: "Semi final",
  b: "B final",
  c: "Final",
  f: "Final",
};

function recordClass(record: string): string {
  if (record === "WR") return "bg-red-100 text-red-700";
  if (record === "NR") return "bg-green-100 text-green-700";
  return "bg-amber-100 text-amber-700";
}

function ResultValue({
  result,
  kind,
}: {
  result: PersonResult;
  kind: "single" | "average";
}) {
  const value = kind === "single" ? result.best : result.average;
  const record = kind === "single" ? result.single_record : result.average_record;
  const isPersonalRecord = kind === "single" ? result.single_pr : result.average_pr;
  return (
    <span className="inline-flex items-center justify-end gap-1.5">
      {record && (
        <span
          className={`rounded px-1 text-[10px] font-semibold leading-4 ${recordClass(record)}`}
        >
          {record}
        </span>
      )}
      <span className={isPersonalRecord ? "font-semibold text-gray-900" : "text-gray-700"}>
        {formatResult(value, result.event_id, kind)}
      </span>
    </span>
  );
}

function Attempts({ result }: { result: PersonResult }) {
  // A zero is an attempt the round's format did not have.
  const attempts = result.attempts.filter((value) => value !== 0);
  return (
    <span className="text-gray-500">
      {attempts.map((value) => formatResult(value, result.event_id, "single")).join("  ")}
    </span>
  );
}

interface Group {
  key: string;
  heading: React.ReactNode;
  results: PersonResult[];
}

function groupResults(results: PersonResult[], grouping: ResultGrouping): Group[] {
  const groups = new Map<string, Group>();
  const ordered =
    grouping === "event"
      ? // A stable sort keeps the newest competition first within each event.
        [...results].sort((a, b) => a.event_rank - b.event_rank)
      : results;
  for (const result of ordered) {
    const key = grouping === "event" ? result.event_id : result.competition_id;
    let group = groups.get(key);
    if (!group) {
      group = {
        key,
        heading:
          grouping === "event" ? (
            result.event_name
          ) : (
            <>
              <CompetitionLink id={result.competition_id} name={result.competition_name} />
              <span className="ml-2 font-normal text-gray-500">
                {formatDate(result.start_date)} · {result.country_name}
              </span>
            </>
          ),
        results: [],
      };
      groups.set(key, group);
    }
    group.results.push(result);
  }
  return [...groups.values()];
}

const COLUMN_COUNT = 6;
const cell = "px-4 py-2 whitespace-nowrap";

function ResultsTable({
  results,
  grouping,
}: {
  results: PersonResult[];
  grouping: ResultGrouping;
}) {
  const groups = useMemo(() => groupResults(results, grouping), [results, grouping]);
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-gray-50 text-left text-xs uppercase text-gray-500">
          <tr>
            <th scope="col" className="px-4 py-2">
              {grouping === "event" ? "Competition" : "Event"}
            </th>
            <th scope="col" className="px-4 py-2">
              Round
            </th>
            <th scope="col" className="px-4 py-2 text-right">
              Place
            </th>
            <th scope="col" className="px-4 py-2 text-right">
              Single
            </th>
            <th scope="col" className="px-4 py-2 text-right">
              Average
            </th>
            <th scope="col" className="px-4 py-2">
              Solves
            </th>
          </tr>
        </thead>
        {groups.map((group) => (
          <tbody key={group.key} className="divide-y divide-gray-100">
            <tr className="bg-gray-50/60">
              <th
                scope="colgroup"
                colSpan={COLUMN_COUNT}
                className="border-t border-gray-200 px-4 pt-4 pb-2 text-left text-sm font-semibold text-gray-800"
              >
                {group.heading}
              </th>
            </tr>
            {group.results.map((result, index) => {
              // Name the competition (or event) on its first round only, as the WCA does.
              const previous = group.results[index - 1];
              const isFirstOfRow =
                grouping === "event"
                  ? previous?.competition_id !== result.competition_id
                  : previous?.event_id !== result.event_id;
              return (
                <tr
                  key={`${result.competition_id}-${result.event_id}-${result.round_type_id}`}
                  className="hover:bg-gray-50"
                >
                  <td className="px-4 py-2">
                    {isFirstOfRow &&
                      (grouping === "event" ? (
                        <>
                          <CompetitionLink
                            id={result.competition_id}
                            name={result.competition_name}
                          />
                          <span className="block text-xs text-gray-500">
                            {formatDate(result.start_date)}
                          </span>
                        </>
                      ) : (
                        <span className="text-gray-700">{result.event_name}</span>
                      ))}
                  </td>
                  <td className={`${cell} text-gray-600`}>
                    {ROUND_NAMES[result.round_type_id] ?? result.round_type_id}
                  </td>
                  <td className={`${cell} text-right text-gray-600`}>{result.pos}</td>
                  <td className={`${cell} text-right`}>
                    <ResultValue result={result} kind="single" />
                  </td>
                  <td className={`${cell} text-right`}>
                    <ResultValue result={result} kind="average" />
                  </td>
                  <td className={cell}>
                    <Attempts result={result} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        ))}
      </table>
    </div>
  );
}

/**
 * Every result of the competitor, grouped by event or by competition. The list is loaded
 * on first view, as it is the largest part of a profile.
 */
export default function PersonResults({
  state,
  grouping,
  onGroupingChange,
  eventId,
  onEventChange,
}: {
  state: ResultsState;
  grouping: ResultGrouping;
  onGroupingChange: (grouping: ResultGrouping) => void;
  eventId: string | null;
  onEventChange: (eventId: string | null) => void;
}) {
  const { results, error } = state;
  const events = useMemo(() => {
    const byId = new Map<string, { id: string; name: string; rank: number }>();
    for (const result of results ?? [])
      byId.set(result.event_id, {
        id: result.event_id,
        name: result.event_name,
        rank: result.event_rank,
      });
    return [...byId.values()].sort((a, b) => a.rank - b.rank);
  }, [results]);
  const selectedEvent = events.some((event) => event.id === eventId) ? eventId : null;
  const shown = useMemo(
    () =>
      selectedEvent
        ? (results ?? []).filter((result) => result.event_id === selectedEvent)
        : (results ?? []),
    [results, selectedEvent],
  );

  if (error) return <p className="px-4 py-3 text-sm text-red-500">{error}</p>;
  if (!results)
    return (
      <div className="my-8 flex justify-center">
        <div className="h-6 w-6 animate-spin rounded-full border-4 border-blue-500 border-t-transparent" />
      </div>
    );
  if (results.length === 0)
    return <EmptyMessage>This competitor has no results yet.</EmptyMessage>;

  return (
    <>
      <div className="flex flex-col gap-3 border-b border-gray-100 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <SegmentedControl
          label="Group results"
          options={GROUPING_OPTIONS}
          value={grouping}
          onChange={onGroupingChange}
        />
        <label className="flex items-center gap-2 text-sm text-gray-600">
          Event
          <select
            className="rounded border border-gray-300 px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
            value={selectedEvent ?? ""}
            onChange={(e) => onEventChange(e.target.value || null)}
          >
            <option value="">All events</option>
            {events.map((event) => (
              <option key={event.id} value={event.id}>
                {event.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      <p className="px-4 py-3 text-sm text-gray-500">
        Bold results were personal records when they were set. WR, NR and the
        continental codes mark official records.
      </p>
      <ResultsTable results={shown} grouping={grouping} />
    </>
  );
}
