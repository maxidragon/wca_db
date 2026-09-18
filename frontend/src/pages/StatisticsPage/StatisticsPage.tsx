import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { backendRequest } from "../../utils/request";
import { formatDate, formatResult } from "../../utils/results";

type Filter =
  | "region"
  | "gender"
  | "year"
  | "events"
  | "event"
  | "type"
  | "pos"
  | "include_dnf";
interface Statistic {
  id: string;
  name: string;
  description: string;
  filters: Filter[];
}
interface Options {
  statistics: Statistic[];
  regions: { id: string; name: string; kind: string }[];
  events: { id: string; name: string; has_average: boolean }[];
  years: number[];
}
interface Column {
  key: string;
  label: string;
  format?: "person" | "competition" | "result" | "date" | "podium" | "attempts";
}
interface PodiumPerson {
  person_id: string;
  person_name: string;
  pos: number;
  value: number;
}
type Row = Record<string, string | number | null | PodiumPerson[] | number[]>;
interface Result {
  columns: Column[];
  rows: Row[];
  total: number;
  page: number;
  page_size: number;
  result_type: "single" | "average";
}
const inputClass =
  "w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400";
const wcaLink = (
  kind: "persons" | "competitions",
  id: string,
  name: string,
) => (
  <a
    className="text-blue-600 hover:underline"
    href={`https://www.worldcubeassociation.org/${kind}/${encodeURIComponent(id)}`}
    target="_blank"
    rel="noopener noreferrer"
  >
    {name}
  </a>
);

async function readResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const data = await response.json().catch(() => null);
    throw new Error(
      data?.error || "Unable to load statistics. Please try again.",
    );
  }
  return response.json();
}

export default function StatisticsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [options, setOptions] = useState<Options | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingOptions, setIsLoadingOptions] = useState(true);
  const [hasSubmitted, setHasSubmitted] = useState(false);
  const [optionsRetry, setOptionsRetry] = useState(0);
  const [retry, setRetry] = useState(0);
  const [draft, setDraft] = useState(() => new URLSearchParams(searchParams));
  const queryString = searchParams.toString();
  const definition = options?.statistics.find(
    (s) => s.id === (draft.get("statistic") || "most-competitions"),
  );
  const has = (filter: Filter) => Boolean(definition?.filters.includes(filter));
  const type = draft.get("type") || "single";
  const selectedEvents = (draft.get("events") || "").split(",").filter(Boolean);

  useEffect(() => {
    const controller = new AbortController();
    setIsLoadingOptions(true);
    backendRequest(
      "api/statistics/options",
      "GET",
      true,
      undefined,
      controller.signal,
    )
      .then(readResponse<Options>)
      .then((data) => {
        if (!controller.signal.aborted) setOptions(data);
      })
      .catch((err: unknown) => {
        if (!controller.signal.aborted) {
          setError(
            err instanceof Error ? err.message : "Unable to load filters",
          );
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setIsLoadingOptions(false);
      });
    return () => {
      controller.abort();
    };
  }, [optionsRetry]);

  useEffect(() => {
    setDraft(new URLSearchParams(queryString));
  }, [queryString]);

  useEffect(() => {
    if (!options || !hasSubmitted) return;
    const controller = new AbortController();
    const params = new URLSearchParams(queryString);
    setIsLoading(true);
    setError(null);
    setResult(null);
    backendRequest(
      `api/statistics?${params}`,
      "GET",
      true,
      undefined,
      controller.signal,
    )
      .then(readResponse<Result>)
      .then((data) => {
        if (!controller.signal.aborted) setResult(data);
      })
      .catch((err: unknown) => {
        if (!controller.signal.aborted)
          setError(
            err instanceof Error ? err.message : "Unable to load statistics",
          );
      })
      .finally(() => {
        if (!controller.signal.aborted) setIsLoading(false);
      });
    return () => {
      controller.abort();
    };
  }, [queryString, options, retry, hasSubmitted]);

  const change = (key: string, value: string) => {
    setDraft((previous) => {
      const next = new URLSearchParams(previous);
      if (value) next.set(key, value);
      else next.delete(key);
      next.delete("page");
      return next;
    });
  };
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const next = new URLSearchParams(draft);
    next.delete("page");
    setHasSubmitted(true);
    if (next.toString() === queryString) setRetry((value) => value + 1);
    else setSearchParams(next);
  };
  const changeStatistic = (id: string) => {
    const nextDefinition = options!.statistics.find((s) => s.id === id)!;
    const next = new URLSearchParams();
    next.set("statistic", id);
    for (const filter of nextDefinition.filters) {
      if (draft.has(filter)) next.set(filter, draft.get(filter)!);
    }
    if (nextDefinition.filters.includes("event") && !next.has("event"))
      next.set("event", "333");
    setDraft(next);
  };
  const setPage = (page: number) => {
    const next = new URLSearchParams(searchParams);
    next.set("page", String(page));
    setSearchParams(next);
  };
  const cell = (column: Column, row: Row) => {
    const value = row[column.key];
    if (value === null || value === undefined) return "—";
    if (column.format === "person")
      return wcaLink("persons", String(row.person_id), String(value));
    if (column.format === "competition")
      return wcaLink("competitions", String(row.competition_id), String(value));
    if (column.format === "date") return formatDate(String(value));
    const eventId = String(row.event_id || searchParams.get("event") || "333");
    if (column.format === "result")
      return formatResult(
        Math.round(Number(value)),
        eventId,
        result!.result_type,
      );
    if (column.format === "attempts" && Array.isArray(value))
      return (value as number[])
        .map((attempt) => formatResult(attempt, eventId, "single"))
        .filter(Boolean)
        .join(" · ");
    if (column.format === "podium" && Array.isArray(value))
      return (
        <ol className="space-y-1 min-w-64">
          {(value as PodiumPerson[])
            .slice()
            .sort((a, b) => a.pos - b.pos)
            .map((person) => (
              <li key={person.person_id}>
                {person.pos}.{" "}
                {wcaLink("persons", person.person_id, person.person_name)}{" "}
                <span className="text-gray-500">
                  {formatResult(
                    Math.round(person.value),
                    eventId,
                    result!.result_type,
                  )}
                </span>
              </li>
            ))}
        </ol>
      );
    return typeof value === "number"
      ? value.toLocaleString(undefined, { maximumFractionDigits: 2 })
      : String(value);
  };
  const pages = result
    ? Math.max(1, Math.ceil(result.total / result.page_size))
    : 1;
  const appliedDefinition = options?.statistics.find(
    (s) => s.id === (searchParams.get("statistic") || "most-competitions"),
  );

  return (
    <div className="mx-auto max-w-6xl py-4">
      <h1 className="text-2xl font-bold text-gray-900">Statistics</h1>
      <p className="mt-1 mb-6 text-sm text-gray-500">
        Explore WCA results with statistics and filters for regions, events,
        genders, and years.
      </p>
      {options && (
        <form
          onSubmit={submit}
          className="mb-6 rounded-xl border border-gray-200 bg-white p-5 shadow-sm"
        >
          <label className="block text-sm font-medium text-gray-700">
            Statistic
            <select
              className={`${inputClass} mt-1`}
              aria-label="Statistic"
              value={draft.get("statistic") || "most-competitions"}
              onChange={(e) => changeStatistic(e.target.value)}
            >
              {!definition && (
                <option
                  aria-label="Statistic"
                  value={draft.get("statistic") || ""}
                >
                  Unknown statistic
                </option>
              )}
              {options.statistics.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
          <p className="mt-2 text-sm text-gray-500">
            {definition?.description}
          </p>
          <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {has("region") && (
              <label className="text-sm font-medium text-gray-700">
                Region
                <select
                  className={`${inputClass} mt-1`}
                  aria-label="Region"
                  value={draft.get("region") || "World"}
                  onChange={(e) => change("region", e.target.value)}
                >
                  <option value="World">World</option>
                  {(["continent", "country"] as const).map((kind) => (
                    <optgroup
                      key={kind}
                      label={kind === "continent" ? "Continents" : "Countries"}
                    >
                      {options.regions
                        .filter((r) => r.kind === kind)
                        .map((r) => (
                          <option key={r.id} value={r.id}>
                            {r.name}
                          </option>
                        ))}
                    </optgroup>
                  ))}
                </select>
              </label>
            )}
            {has("gender") && (
              <label className="text-sm font-medium text-gray-700">
                Gender
                <select
                  className={`${inputClass} mt-1`}
                  aria-label="Gender"
                  value={draft.get("gender") || "all"}
                  onChange={(e) => change("gender", e.target.value)}
                >
                  <option value="all">All genders</option>
                  <option value="m">Male</option>
                  <option value="f">Female</option>
                  <option value="o">Other</option>
                </select>
              </label>
            )}
            {has("year") && (
              <label className="text-sm font-medium text-gray-700">
                Year
                <select
                  className={`${inputClass} mt-1`}
                  aria-label="Year"
                  value={draft.get("year") || "all"}
                  onChange={(e) => change("year", e.target.value)}
                >
                  <option value="all">All years</option>
                  {options.years.map((year) => (
                    <option key={year} value={year}>
                      {year}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {has("type") && (
              <label className="text-sm font-medium text-gray-700">
                Result type
                <select
                  className={`${inputClass} mt-1`}
                  aria-label="Result type"
                  value={type}
                  onChange={(e) => {
                    const nextType = e.target.value;
                    setDraft((previous) => {
                      const next = new URLSearchParams(previous);
                      next.set("type", nextType);
                      next.delete("page");
                      if (nextType === "average") {
                        next.set(
                          "events",
                          selectedEvents
                            .filter(
                              (id) =>
                                options.events.find((event) => event.id === id)
                                  ?.has_average,
                            )
                            .join(","),
                        );
                        if (
                          has("event") &&
                          !options.events.find(
                            (event) =>
                              event.id === (next.get("event") || "333"),
                          )?.has_average
                        )
                          next.set("event", "333");
                      }
                      if (!has("events")) next.delete("events");
                      return next;
                    });
                  }}
                >
                  <option value="single">Single</option>
                  <option value="average">Average</option>
                </select>
              </label>
            )}
            {has("event") && (
              <label className="text-sm font-medium text-gray-700">
                Event
                <select
                  className={`${inputClass} mt-1`}
                  aria-label="Event"
                  value={draft.get("event") || "333"}
                  onChange={(e) => change("event", e.target.value)}
                >
                  {options.events
                    .filter(
                      (event) =>
                        !has("type") || type !== "average" || event.has_average,
                    )
                    .map((event) => (
                      <option key={event.id} value={event.id}>
                        {event.name}
                      </option>
                    ))}
                </select>
              </label>
            )}
            {has("pos") && (
              <label className="text-sm font-medium text-gray-700">
                Place
                <select
                  className={`${inputClass} mt-1`}
                  aria-label="Place"
                  value={draft.get("pos") || "2"}
                  onChange={(e) => change("pos", e.target.value)}
                >
                  <option value="2">2nd place</option>
                  <option value="4">4th place</option>
                </select>
              </label>
            )}
            {has("include_dnf") && (
              <label className="flex items-center gap-2 text-sm font-medium text-gray-700">
                <input
                  type="checkbox"
                  checked={draft.get("include_dnf") === "1"}
                  onChange={(e) =>
                    change("include_dnf", e.target.checked ? "1" : "0")
                  }
                />
                Include DNF / DNS rounds
              </label>
            )}
          </div>
          {has("events") && (
            <fieldset className="mt-4">
              <legend className="text-sm font-medium text-gray-700">
                Events{" "}
                <span className="font-normal text-gray-500">
                  (none selected = all events)
                </span>
              </legend>
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-2">
                {options.events
                  .filter(
                    (event) =>
                      !has("type") || type !== "average" || event.has_average,
                  )
                  .map((event) => (
                    <label
                      key={event.id}
                      className="flex items-center gap-2 text-sm text-gray-600"
                    >
                      <input
                        type="checkbox"
                        checked={selectedEvents.includes(event.id)}
                        onChange={(e) =>
                          change(
                            "events",
                            (e.target.checked
                              ? [...selectedEvents, event.id]
                              : selectedEvents.filter((id) => id !== event.id)
                            ).join(","),
                          )
                        }
                      />
                      {event.name}
                    </label>
                  ))}
              </div>
              <div className="mt-3 flex gap-4 text-sm">
                <button
                  type="button"
                  onClick={() => change("events", "")}
                  className="text-blue-600 hover:underline cursor-pointer"
                >
                  All events
                </button>
                <button
                  type="button"
                  onClick={() => change("events", "222,333,444,555")}
                  className="text-blue-600 hover:underline cursor-pointer"
                >
                  2×2 to 5×5
                </button>
              </div>
            </fieldset>
          )}
          <div className="mt-5 flex gap-3">
            <button
              type="submit"
              disabled={isLoading || !definition}
              className="rounded-lg bg-blue-500 px-4 py-2 text-sm font-medium text-white hover:bg-blue-600 disabled:bg-gray-400 cursor-pointer"
            >
              {isLoading ? "Loading…" : "Show statistics"}
            </button>
            <button
              type="button"
              onClick={() => {
                setHasSubmitted(false);
                setResult(null);
                setError(null);
                setIsLoading(false);
                setDraft(new URLSearchParams());
                setSearchParams({});
              }}
              className="rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-600 hover:bg-gray-50 cursor-pointer"
            >
              Reset filters
            </button>
          </div>
        </form>
      )}
      <div aria-live="polite" aria-busy={isLoading || isLoadingOptions}>
        {isLoadingOptions && (
          <p className="py-8 text-center text-gray-500" role="status">
            Loading filters…
          </p>
        )}
        {options && !hasSubmitted && !error && (
          <p className="py-8 text-center text-gray-500">
            Choose a statistic and filters, then click Show statistics.
          </p>
        )}
        {isLoading && (
          <p className="py-8 text-center text-gray-500" role="status">
            Loading statistics…
          </p>
        )}
        {error && (
          <div
            className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700"
            role="alert"
          >
            {error}
            <button
              type="button"
              onClick={() => {
                setError(null);
                if (options) setRetry((value) => value + 1);
                else setOptionsRetry((value) => value + 1);
              }}
              className="ml-3 underline cursor-pointer"
            >
              Retry
            </button>
          </div>
        )}
        {result && !isLoading && (
          <>
            <h2 className="mb-2 text-lg font-semibold text-gray-800">
              {appliedDefinition?.name}
            </h2>
            {result.rows.length === 0 ? (
              <p className="rounded-lg bg-white p-6 text-gray-500">
                No results match these filters.
              </p>
            ) : (
              <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
                <table className="w-full text-sm">
                  <caption className="sr-only">
                    {appliedDefinition?.name} standings
                  </caption>
                  <thead className="bg-gray-50 text-left text-xs uppercase text-gray-500">
                    <tr>
                      <th scope="col" className="px-4 py-3">
                        Rank
                      </th>
                      {result.columns.map((column) => (
                        <th
                          scope="col"
                          key={column.key}
                          className="px-4 py-3 whitespace-nowrap"
                        >
                          {column.label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {result.rows.map((row, index) => (
                      <tr key={index} className="hover:bg-gray-50">
                        <td className="px-4 py-3 font-semibold">
                          {String(row.rank)}
                        </td>
                        {result.columns.map((column) => (
                          <td
                            key={column.key}
                            className="px-4 py-3 whitespace-nowrap"
                          >
                            {cell(column, row)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm text-gray-600">
              <span>
                {result.total.toLocaleString()} results · Page {result.page} of{" "}
                {pages}
              </span>
              <div className="flex gap-2">
                <button
                  disabled={result.page <= 1}
                  onClick={() => setPage(result.page - 1)}
                  className="rounded border border-gray-300 bg-white px-3 py-2 disabled:opacity-40 cursor-pointer"
                >
                  Previous
                </button>
                <button
                  disabled={result.page >= pages}
                  onClick={() => setPage(result.page + 1)}
                  className="rounded border border-gray-300 bg-white px-3 py-2 disabled:opacity-40 cursor-pointer"
                >
                  Next
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
