import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { backendRequest } from "../../utils/request";
import { formatDate, formatResult } from "../../utils/results";

const WCA_ORIGIN = "https://www.worldcubeassociation.org";
const UNIQUE_LIST = "unique";

interface Competition {
  id: string;
  name: string;
  start_date: string;
  end_date: string;
  country_id: string;
}

interface Requirement {
  type: "attemptResult" | "ranking" | "anyResult";
  result_type: "single" | "average";
  when_date: string;
  level: number | null;
}

interface EventRequirement {
  event_id: string;
  event_name: string;
  requirement: Requirement;
  count: number | null;
}

interface Competitor {
  wca_id: string;
  name: string;
  country_id: string | null;
  country_name: string | null;
}

interface EventQualifier extends Competitor {
  result: number;
  competition_id: string;
  competition_name: string;
}

interface UniqueQualifier extends Competitor {
  events: string[];
}

interface QualificationsResult {
  competition: Competition;
  events: EventRequirement[];
  unique_count: number;
  list: string;
  page: number;
  page_size: number;
  qualifiers: EventQualifier[] | UniqueQualifier[];
}

/** The requirement as the WCA words it on a competition's events page. */
function describeRequirement(eventId: string, requirement: Requirement): string {
  const kind = requirement.result_type === "single" ? "Single" : "Average";
  const level = requirement.level ?? 0;
  if (requirement.type === "ranking") {
    return `Top ${level} in the world by ${requirement.result_type}`;
  }
  if (requirement.type === "anyResult") {
    return `Any successful ${requirement.result_type}`;
  }
  if (eventId === "333mbf") {
    const points = 99 - Math.floor(level / 10000000);
    return `${kind} of at least ${points} ${points === 1 ? "point" : "points"}`;
  }
  if (eventId === "333fm") {
    return `${kind} under ${formatResult(level, eventId, requirement.result_type)} moves`;
  }
  return `${kind} under ${formatResult(level, eventId, requirement.result_type)}`;
}

function PersonLink({ wcaId, name }: { wcaId: string; name: string }) {
  return (
    <a
      href={`${WCA_ORIGIN}/persons/${wcaId}`}
      target="_blank"
      rel="noopener noreferrer"
      className="text-blue-600 hover:underline"
    >
      {name}
    </a>
  );
}

const QualificationsPage = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const competitionId = (searchParams.get("competition_id") || "").trim();
  const list = searchParams.get("list") || UNIQUE_LIST;
  const page = Math.max(1, Number(searchParams.get("page")) || 1);
  const [query, setQuery] = useState(competitionId);
  const [suggestions, setSuggestions] = useState<Competition[]>([]);
  const [searchOpen, setSearchOpen] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const [result, setResult] = useState<QualificationsResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const searchVersion = useRef(0);

  // The lists follow the URL, so a shared link, the selected list and the page all load what
  // they name.
  useEffect(() => {
    if (!competitionId) {
      setResult(null);
      setError(null);
      return;
    }
    const request = new AbortController();
    setError(null);
    setIsLoading(true);
    (async () => {
      try {
        const res = await backendRequest(
          `api/qualifications?competition_id=${encodeURIComponent(competitionId)}&list=${encodeURIComponent(list)}&page=${page}`,
          "GET",
          true,
          undefined,
          request.signal,
        );
        const data = await res.json();
        if (res.ok) {
          setResult(data);
          setQuery(data.competition.name);
        } else {
          setResult(null);
          setError(data.error || "Unknown error");
        }
      } catch (err) {
        if (!request.signal.aborted) {
          setResult(null);
          setError(err instanceof Error ? err.message : "Could not load the qualifications");
        }
      } finally {
        if (!request.signal.aborted) setIsLoading(false);
      }
    })();
    return () => request.abort();
  }, [competitionId, list, page]);

  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < 2 || result?.competition.name === query) {
      setSuggestions([]);
      setIsSearching(false);
      return;
    }
    const version = ++searchVersion.current;
    const timer = window.setTimeout(async () => {
      setIsSearching(true);
      try {
        const response = await backendRequest(
          `api/competitions/search?q=${encodeURIComponent(trimmed)}&with_qualifications=1`,
          "GET",
          true,
        );
        const data = await response.json();
        if (version === searchVersion.current) {
          setSuggestions(response.ok ? data.competitions : []);
          setSearchOpen(true);
        }
      } catch {
        if (version === searchVersion.current) setSuggestions([]);
      } finally {
        if (version === searchVersion.current) setIsSearching(false);
      }
    }, 250);
    return () => window.clearTimeout(timer);
  }, [query, result?.competition.name]);

  const update = (changes: Record<string, string | null>) => {
    const next = new URLSearchParams(searchParams);
    for (const [key, value] of Object.entries(changes)) {
      if (value === null) next.delete(key);
      else next.set(key, value);
    }
    setSearchParams(next);
  };

  const selectCompetition = (id: string) => {
    setSuggestions([]);
    setSearchOpen(false);
    setSearchParams({ competition_id: id });
  };

  const submitSearch = (event: React.FormEvent) => {
    event.preventDefault();
    const trimmed = query.trim();
    const exact = suggestions.find(
      (competition) => competition.id.toLowerCase() === trimmed.toLowerCase(),
    );
    if (exact) selectCompetition(exact.id);
    else if (/^[a-z0-9_-]*\d{4}$/i.test(trimmed)) selectCompetition(trimmed);
    else if (suggestions.length === 1) selectCompetition(suggestions[0].id);
    else setSearchOpen(true);
  };

  // The requirements belong to the competition, not the list, so they stay while a list loads.
  const current =
    result && result.competition.id.toLowerCase() === competitionId.toLowerCase() ? result : null;
  const shown = current && current.list === list ? current : null;
  const checked = current ? current.events.filter((event) => event.count !== null) : [];
  const unchecked = current ? current.events.filter((event) => event.count === null) : [];
  const selected = current?.events.find((event) => event.event_id === list) ?? null;
  const total = current ? (selected ? selected.count ?? 0 : current.unique_count) : 0;
  const pages = shown ? Math.max(1, Math.ceil(total / shown.page_size)) : 1;
  const eventNames = new Map(current?.events.map((event) => [event.event_id, event.event_name]));

  const tabClass = (active: boolean) =>
    `cursor-pointer rounded px-3 py-1.5 font-medium transition-colors ${
      active ? "bg-blue-100 text-blue-700" : "text-gray-600 hover:bg-gray-100 hover:text-gray-900"
    }`;

  return (
    <div className="mx-auto max-w-6xl p-4">
      <h2 className="mb-1 text-2xl font-bold">Qualifications</h2>
      <p className="mb-6 text-sm text-gray-500">
        Everyone who meets a competition's qualification requirements, per event and as one list
        of unique competitors.
      </p>

      <form onSubmit={submitSearch} className="relative mb-6 max-w-2xl">
        <div className="flex gap-2">
          <div className="relative flex-1">
            <input
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setSearchOpen(true);
              }}
              onFocus={() => setSearchOpen(true)}
              placeholder="Search competitions with qualification requirements"
              className="w-full rounded-lg border border-gray-300 bg-white px-4 py-2.5 pr-10 focus:outline-none focus:ring-2 focus:ring-blue-400"
            />
            {isSearching && (
              <div className="absolute right-3 top-3 h-5 w-5 animate-spin rounded-full border-2 border-blue-500 border-t-transparent" />
            )}
          </div>
          <button
            type="submit"
            disabled={isLoading || query.trim().length < 2}
            className="cursor-pointer rounded-lg bg-blue-500 px-5 py-2.5 text-white hover:bg-blue-600 disabled:cursor-not-allowed disabled:bg-gray-400"
          >
            Search
          </button>
        </div>

        {searchOpen && suggestions.length > 0 && (
          <div className="absolute z-20 mt-1 max-h-80 w-[calc(100%-6.5rem)] overflow-y-auto rounded-lg border border-gray-200 bg-white shadow-lg">
            {suggestions.map((competition) => (
              <button
                key={competition.id}
                type="button"
                onClick={() => selectCompetition(competition.id)}
                className="flex w-full cursor-pointer items-center justify-between gap-4 border-b border-gray-100 px-4 py-3 text-left last:border-0 hover:bg-blue-50"
              >
                <span>
                  <span className="block text-sm font-medium text-gray-800">{competition.name}</span>
                  <span className="block text-xs text-gray-400">{competition.id}</span>
                </span>
                <span className="shrink-0 text-xs text-gray-500">
                  {formatDate(competition.start_date)}
                </span>
              </button>
            ))}
          </div>
        )}
      </form>

      {current && (
        <div className="mb-6">
          <a
            href={`${WCA_ORIGIN}/competitions/${current.competition.id}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xl font-semibold text-gray-900 hover:underline"
          >
            {current.competition.name}
          </a>
          <p className="text-sm text-gray-500">{formatDate(current.competition.start_date)}</p>
        </div>
      )}

      {current && current.events.length > 0 && (
        <>
          <div className="mb-4 flex flex-wrap gap-1 rounded-lg border border-gray-300 bg-white p-1 text-sm">
            <button
              type="button"
              onClick={() => update({ list: null, page: null })}
              className={tabClass(list === UNIQUE_LIST)}
            >
              Unique competitors
              <span className="ml-1.5 text-xs text-gray-500">
                {current.unique_count.toLocaleString()}
              </span>
            </button>
            {checked.map((event) => (
              <button
                key={event.event_id}
                type="button"
                onClick={() => update({ list: event.event_id, page: null })}
                className={tabClass(list === event.event_id)}
              >
                {event.event_name}
                <span className="ml-1.5 text-xs text-gray-500">
                  {event.count!.toLocaleString()}
                </span>
              </button>
            ))}
          </div>

          <div className="mb-6 text-sm text-gray-600">
            {selected ? (
              <p>
                {describeRequirement(selected.event_id, selected.requirement)}, in a competition
                ending by {formatDate(selected.requirement.when_date)}.
              </p>
            ) : (
              <p>Everyone who meets at least one of the requirements listed per event.</p>
            )}
            {unchecked.length > 0 && (
              <p className="mt-1 text-gray-500">
                Not listed, because organisers trim a ranking requirement themselves:{" "}
                {unchecked
                  .map(
                    (event) =>
                      `${event.event_name} (${describeRequirement(event.event_id, event.requirement).toLowerCase()})`,
                  )
                  .join(", ")}
                .
              </p>
            )}
          </div>
        </>
      )}

      {isLoading && (
        <div className="my-8 flex justify-center">
          <div className="h-6 w-6 animate-spin rounded-full border-4 border-blue-500 border-t-transparent" />
        </div>
      )}

      {error && !isLoading && <p className="text-red-500">{error}</p>}

      {shown && !isLoading && !error && (
        shown.events.length === 0 ? (
          <p className="text-gray-600">This competition has no qualification requirements.</p>
        ) : total === 0 ? (
          <p className="text-gray-600">
            {checked.length === 0
              ? "This competition only has ranking requirements, which are not listed."
              : "Nobody meets this requirement yet."}
          </p>
        ) : (
          <>
            <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-xs uppercase text-gray-500">
                  <tr>
                    <th className="px-4 py-2 text-right">#</th>
                    <th className="px-4 py-2 text-left">Name</th>
                    <th className="px-4 py-2 text-left">WCA ID</th>
                    <th className="px-4 py-2 text-left">Country</th>
                    {selected ? (
                      <>
                        <th className="px-4 py-2 text-right">Result</th>
                        <th className="px-4 py-2 text-left">Achieved at</th>
                      </>
                    ) : (
                      <th className="px-4 py-2 text-left">Events</th>
                    )}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {shown.qualifiers.map((qualifier, index) => (
                    <tr key={qualifier.wca_id} className="transition-colors hover:bg-gray-50">
                      <td className="px-4 py-2 text-right text-gray-500">
                        {(shown.page - 1) * shown.page_size + index + 1}
                      </td>
                      <td className="px-4 py-2">
                        <PersonLink wcaId={qualifier.wca_id} name={qualifier.name} />
                      </td>
                      <td className="px-4 py-2 font-mono text-gray-600">{qualifier.wca_id}</td>
                      <td className="px-4 py-2 text-gray-600">{qualifier.country_name ?? "—"}</td>
                      {selected && "result" in qualifier ? (
                        <>
                          <td className="px-4 py-2 text-right font-mono">
                            {formatResult(
                              qualifier.result,
                              selected.event_id,
                              selected.requirement.result_type,
                            )}
                          </td>
                          <td className="px-4 py-2">
                            <a
                              href={`${WCA_ORIGIN}/competitions/${qualifier.competition_id}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-blue-600 hover:underline"
                            >
                              {qualifier.competition_name}
                            </a>
                          </td>
                        </>
                      ) : (
                        <td className="px-4 py-2 text-gray-600">
                          {"events" in qualifier &&
                            `${qualifier.events.length} · ${qualifier.events
                              .map((event) => eventNames.get(event) ?? event)
                              .join(", ")}`}
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm text-gray-600">
              <span>
                {total.toLocaleString()} {selected ? "qualifiers" : "unique competitors"} · Page{" "}
                {shown.page} of {pages}
              </span>
              <div className="flex gap-2">
                <button
                  disabled={shown.page <= 1}
                  onClick={() => update({ page: String(shown.page - 1) })}
                  className="cursor-pointer rounded border border-gray-300 bg-white px-3 py-2 disabled:opacity-40"
                >
                  Previous
                </button>
                <button
                  disabled={shown.page >= pages}
                  onClick={() => update({ page: String(shown.page + 1) })}
                  className="cursor-pointer rounded border border-gray-300 bg-white px-3 py-2 disabled:opacity-40"
                >
                  Next
                </button>
              </div>
            </div>
          </>
        )
      )}
    </div>
  );
};

export default QualificationsPage;
