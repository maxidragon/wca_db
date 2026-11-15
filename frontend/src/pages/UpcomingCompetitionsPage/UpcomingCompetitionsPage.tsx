import { lazy, Suspense, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useDebounce } from "@uidotdev/usehooks";
import { backendRequest } from "../../utils/request";
import { formatDateRange } from "../../utils/results";
import {
  competitorsLabel,
  REGISTRATION_STATUSES,
  registrationDetail,
  statusInfo,
  WCA_ORIGIN,
  type UpcomingCompetitionsOptions,
  type UpcomingCompetitionsResult,
} from "./types";

// Leaflet is only fetched once someone opens the map.
const CompetitionsMap = lazy(() => import("./CompetitionsMap"));

// Filters the backend reads; the view is the page's own and is not sent.
const FILTER_KEYS = [
  "q",
  "region",
  "from",
  "to",
  "events",
  "championships",
  "min_limit",
  "max_limit",
  "registration",
  "new_countries",
  "near",
  "radius_km",
  "sort",
  "duration",
  "weekend",
];

// About 100 m: enough to measure distances, and a shared link does not pinpoint anyone's home.
const roundCoordinate = (value: number) => Math.round(value * 1000) / 1000;
const formatCentre = (near: string) =>
  near
    .split(",")
    .map((part, i) => {
      const value = Number(part);
      const hemisphere = i === 0 ? (value >= 0 ? "N" : "S") : value >= 0 ? "E" : "W";
      return `${Math.abs(value).toFixed(3)}° ${hemisphere}`;
    })
    .join(", ");

const inputClass =
  "w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400";
const chipClass = (active: boolean) =>
  `cursor-pointer rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
    active
      ? "border-blue-500 bg-blue-50 text-blue-700"
      : "border-gray-300 bg-white text-gray-600 hover:bg-gray-50"
  }`;
const modeClass = (active: boolean) =>
  `cursor-pointer rounded px-3 py-1.5 font-medium transition-colors ${
    active ? "bg-blue-100 text-blue-700" : "text-gray-600 hover:bg-gray-100 hover:text-gray-900"
  }`;

async function readResponse<T>(response: Response, fallback: string): Promise<T> {
  if (!response.ok) {
    const data = await response.json().catch(() => null);
    throw new Error(data?.error || fallback);
  }
  return response.json();
}

/** A text input that writes to the URL once typing pauses. */
function DebouncedInput({
  value,
  onCommit,
  ...props
}: { value: string; onCommit: (value: string) => void } & Omit<
  React.InputHTMLAttributes<HTMLInputElement>,
  "value" | "onChange"
>) {
  const [draft, setDraft] = useState(value);
  const debounced = useDebounce(draft, 350);
  // The URL changing elsewhere (back, a shared link, "Clear") refills the input.
  useEffect(() => setDraft(value), [value]);
  useEffect(() => {
    if (debounced !== value) onCommit(debounced.trim());
    // Only a pause in typing commits; a new value from the URL must not write itself back.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced]);
  return <input {...props} className={inputClass} value={draft} onChange={(e) => setDraft(e.target.value)} />;
}

export default function UpcomingCompetitionsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [options, setOptions] = useState<UpcomingCompetitionsOptions | null>(null);
  const [result, setResult] = useState<UpcomingCompetitionsResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [retry, setRetry] = useState(0);

  const view = searchParams.get("view") === "map" ? "map" : "list";
  const filterQuery = new URLSearchParams(
    [...searchParams].filter(([key]) => FILTER_KEYS.includes(key)),
  ).toString();
  const selectedEvents = (searchParams.get("events") || "").split(",").filter(Boolean);
  const selectedStatuses = (searchParams.get("registration") || "").split(",").filter(Boolean);
  const championships = searchParams.get("championships") || "include";
  const hasFilters = filterQuery !== "";
  const near = searchParams.get("near");
  const [locating, setLocating] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    backendRequest("api/upcoming-competitions/options", "GET", true, undefined, controller.signal)
      .then((response) => readResponse<UpcomingCompetitionsOptions>(response, "Unable to load the filters"))
      .then((data) => {
        if (!controller.signal.aborted) setOptions(data);
      })
      .catch((err: unknown) => {
        if (!controller.signal.aborted) setError(err instanceof Error ? err.message : "Unable to load the filters");
      });
    return () => controller.abort();
  }, [retry]);

  useEffect(() => {
    const controller = new AbortController();
    setIsLoading(true);
    setError(null);
    backendRequest(`api/upcoming-competitions?${filterQuery}`, "GET", true, undefined, controller.signal)
      .then((response) =>
        readResponse<UpcomingCompetitionsResult>(response, "Unable to load the competitions"),
      )
      .then((data) => {
        if (!controller.signal.aborted) setResult(data);
      })
      .catch((err: unknown) => {
        if (!controller.signal.aborted) {
          setResult(null);
          setError(err instanceof Error ? err.message : "Unable to load the competitions");
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setIsLoading(false);
      });
    return () => controller.abort();
  }, [filterQuery, retry]);

  const update = (key: string, value: string) => {
    setSearchParams(
      (previous) => {
        const next = new URLSearchParams(previous);
        if (value) next.set(key, value);
        else next.delete(key);
        return next;
      },
      { replace: key === "q" || key.endsWith("_limit") || key === "radius_km" },
    );
  };
  const updateMany = (values: Record<string, string>) =>
    setSearchParams((previous) => {
      const next = new URLSearchParams(previous);
      for (const [key, value] of Object.entries(values)) {
        if (value) next.set(key, value);
        else next.delete(key);
      }
      return next;
    });
  const setCentre = (latitude: number, longitude: number) =>
    update("near", `${roundCoordinate(latitude)},${roundCoordinate(longitude)}`);
  // Without a centre there is nothing to measure from, so the radius and the sort go with it.
  const clearCentre = () => updateMany({ near: "", radius_km: "", sort: "" });
  const locate = () => {
    if (!navigator.geolocation) {
      setError("This browser cannot share its location. Click the map to pick a point instead.");
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setLocating(false);
        setCentre(position.coords.latitude, position.coords.longitude);
      },
      () => {
        setLocating(false);
        setError("Could not get your location. Allow it in the browser, or click the map to pick a point.");
      },
      { maximumAge: 10 * 60 * 1000, timeout: 15000 },
    );
  };
  const toggleIn = (key: string, selected: string[], id: string) =>
    update(key, (selected.includes(id) ? selected.filter((s) => s !== id) : [...selected, id]).join(","));
  const clearFilters = () => setSearchParams(view === "map" ? { view } : {});

  // Only a competitor with a WCA ID has countries they competed in; the response says who that is.
  const canFilterNewCountries = Boolean(result?.viewer_wca_id) || searchParams.get("new_countries") === "1";

  return (
    <div className="mx-auto max-w-6xl py-4">
      <h1 className="text-2xl font-bold text-gray-900">Upcoming Competitions</h1>
      <p className="mt-1 mb-6 text-sm text-gray-500">
        Every announced competition that has not ended yet, as a list or on a map. Registration
        counts come from the latest export, so they can be up to a day old.
      </p>

      <div className="mb-6 rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <label className="text-sm font-medium text-gray-700">
            Search
            <div className="mt-1">
              <DebouncedInput
                type="search"
                placeholder="Name or city"
                maxLength={100}
                value={searchParams.get("q") || ""}
                onCommit={(value) => update("q", value)}
              />
            </div>
          </label>
          <label className="text-sm font-medium text-gray-700">
            Region
            <select
              className={`${inputClass} mt-1`}
              value={searchParams.get("region") || "World"}
              onChange={(e) => update("region", e.target.value === "World" ? "" : e.target.value)}
              disabled={!options}
            >
              <option value="World">World</option>
              {(["continent", "country"] as const).map((kind) => (
                <optgroup key={kind} label={kind === "continent" ? "Continents" : "Countries"}>
                  {options?.regions
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
          <label className="text-sm font-medium text-gray-700">
            Starting from
            <input
              type="date"
              className={`${inputClass} mt-1`}
              value={searchParams.get("from") || ""}
              max={searchParams.get("to") || undefined}
              onChange={(e) => update("from", e.target.value)}
            />
          </label>
          <label className="text-sm font-medium text-gray-700">
            Starting until
            <input
              type="date"
              className={`${inputClass} mt-1`}
              value={searchParams.get("to") || ""}
              min={searchParams.get("from") || undefined}
              onChange={(e) => update("to", e.target.value)}
            />
          </label>
          <label className="text-sm font-medium text-gray-700">
            Championships
            <select
              className={`${inputClass} mt-1`}
              value={championships}
              onChange={(e) => update("championships", e.target.value === "include" ? "" : e.target.value)}
            >
              <option value="include">Include championships</option>
              <option value="exclude">Exclude championships</option>
              <option value="only">Only championships</option>
            </select>
          </label>
          <div className="text-sm font-medium text-gray-700">
            Competitor limit
            <div className="mt-1 flex items-center gap-2">
              <DebouncedInput
                type="number"
                min={0}
                inputMode="numeric"
                placeholder="Min"
                aria-label="Minimum competitor limit"
                value={searchParams.get("min_limit") || ""}
                onCommit={(value) => update("min_limit", value)}
              />
              <span className="text-gray-400">–</span>
              <DebouncedInput
                type="number"
                min={0}
                inputMode="numeric"
                placeholder="Max"
                aria-label="Maximum competitor limit"
                value={searchParams.get("max_limit") || ""}
                onCommit={(value) => update("max_limit", value)}
              />
            </div>
          </div>
          <fieldset className="text-sm font-medium text-gray-700 sm:col-span-2">
            <legend>
              Registration <span className="font-normal text-gray-500">(none selected = any)</span>
            </legend>
            <div className="mt-2 flex flex-wrap gap-2">
              {REGISTRATION_STATUSES.map((status) => (
                <button
                  key={status.id}
                  type="button"
                  aria-pressed={selectedStatuses.includes(status.id)}
                  className={chipClass(selectedStatuses.includes(status.id))}
                  onClick={() => toggleIn("registration", selectedStatuses, status.id)}
                >
                  {status.label}
                </button>
              ))}
            </div>
          </fieldset>
        </div>

        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="text-sm font-medium text-gray-700 sm:col-span-2">
            Distance from
            <div className="mt-1 flex flex-wrap items-center gap-2">
              {near ? (
                <>
                  <span className="rounded-lg border border-gray-300 bg-gray-50 px-3 py-2 font-normal tabular-nums">
                    {formatCentre(near)}
                  </span>
                  <button
                    type="button"
                    onClick={clearCentre}
                    className="cursor-pointer text-sm font-normal text-blue-600 hover:underline"
                  >
                    Clear
                  </button>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={locate}
                    disabled={locating}
                    className="cursor-pointer rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm hover:bg-gray-50 disabled:cursor-wait disabled:opacity-60"
                  >
                    {locating ? "Locating…" : "Use my location"}
                  </button>
                  <span className="font-normal text-gray-500">
                    or{" "}
                    {view === "map" ? (
                      "click the map"
                    ) : (
                      <button
                        type="button"
                        onClick={() => update("view", "map")}
                        className="cursor-pointer text-blue-600 hover:underline"
                      >
                        click the map
                      </button>
                    )}
                  </span>
                </>
              )}
            </div>
          </div>
          <label className="text-sm font-medium text-gray-700">
            Within (km)
            <div className="mt-1">
              <DebouncedInput
                type="number"
                min={1}
                inputMode="numeric"
                placeholder={near ? "Any distance" : "Pick a point first"}
                disabled={!near}
                value={searchParams.get("radius_km") || ""}
                onCommit={(value) => update("radius_km", value)}
              />
            </div>
          </label>
          <label className="text-sm font-medium text-gray-700">
            Sort by
            <select
              className={`${inputClass} mt-1`}
              value={near ? searchParams.get("sort") || "date" : "date"}
              disabled={!near}
              onChange={(e) => update("sort", e.target.value === "date" ? "" : e.target.value)}
            >
              <option value="date">Date</option>
              <option value="distance">Distance</option>
            </select>
          </label>
          <label className="text-sm font-medium text-gray-700">
            Length
            <select
              className={`${inputClass} mt-1`}
              value={searchParams.get("duration") || "any"}
              onChange={(e) => update("duration", e.target.value === "any" ? "" : e.target.value)}
            >
              <option value="any">Any length</option>
              <option value="single">Single day</option>
              <option value="multi">Multi-day</option>
            </select>
          </label>
          <label className="flex items-center gap-2 self-end pb-2 text-sm font-medium text-gray-700">
            <input
              type="checkbox"
              checked={searchParams.get("weekend") === "1"}
              onChange={(e) => update("weekend", e.target.checked ? "1" : "")}
            />
            <span>
              Weekend only <span className="font-normal text-gray-500">(Sat–Sun)</span>
            </span>
          </label>
        </div>

        <fieldset className="mt-4">
          <legend className="text-sm font-medium text-gray-700">
            Events <span className="font-normal text-gray-500">(competitions holding every selected event)</span>
          </legend>
          <div className="mt-2 flex flex-wrap gap-2">
            {options?.events.map((event) => (
              <button
                key={event.id}
                type="button"
                aria-pressed={selectedEvents.includes(event.id)}
                className={chipClass(selectedEvents.includes(event.id))}
                onClick={() => toggleIn("events", selectedEvents, event.id)}
              >
                {event.name}
              </button>
            ))}
          </div>
        </fieldset>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          {canFilterNewCountries ? (
            <label className="flex items-center gap-2 text-sm font-medium text-gray-700">
              <input
                type="checkbox"
                checked={searchParams.get("new_countries") === "1"}
                onChange={(e) => update("new_countries", e.target.checked ? "1" : "")}
              />
              Only countries I have not competed in
              {result?.competed_countries != null && (
                <span className="font-normal text-gray-500">
                  (you have competed in {result.competed_countries})
                </span>
              )}
            </label>
          ) : result ? (
            <span className="text-sm text-gray-500">
              Log in with an account that has a WCA ID to find countries you have not competed in.
            </span>
          ) : (
            <span />
          )}
          {hasFilters && (
            <button
              type="button"
              onClick={clearFilters}
              className="cursor-pointer text-sm text-blue-600 hover:underline"
            >
              Clear filters
            </button>
          )}
        </div>
      </div>

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-gray-600" aria-live="polite">
          {isLoading
            ? "Loading…"
            : result
              ? `${result.total} ${result.total === 1 ? "competition" : "competitions"}`
              : ""}
        </p>
        <div className="inline-flex rounded-lg border border-gray-300 bg-white p-1 text-sm">
          <button type="button" className={modeClass(view === "list")} onClick={() => update("view", "")}>
            List
          </button>
          <button type="button" className={modeClass(view === "map")} onClick={() => update("view", "map")}>
            Map
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-4 flex items-center justify-between gap-3 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          <span>{error}</span>
          <button
            type="button"
            onClick={() => setRetry((value) => value + 1)}
            className="cursor-pointer font-medium underline"
          >
            Try again
          </button>
        </div>
      )}

      {result && result.total === 0 && !isLoading && (
        <p className="mb-4 rounded-xl border border-gray-200 bg-white p-8 text-center text-gray-500 shadow-sm">
          No upcoming competitions match these filters.
        </p>
      )}

      {/* The map stays when nothing matches, so a new point can still be picked on it. */}
      {result && view === "map" && (
        <Suspense fallback={<p className="text-sm text-gray-500">Loading the map…</p>}>
          <CompetitionsMap
            competitions={result.competitions}
            near={near}
            radiusKm={Number(searchParams.get("radius_km")) || null}
            onPick={setCentre}
          />
        </Suspense>
      )}

      {result && result.total > 0 && view === "list" && (
        <div className={`overflow-x-auto rounded-xl border border-gray-200 bg-white shadow-sm ${isLoading ? "opacity-60" : ""}`}>
          <table className="min-w-full divide-y divide-gray-200 text-sm">
            <thead className="bg-gray-50 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
              <tr>
                <th className="px-4 py-3">Date</th>
                <th className="px-4 py-3">Competition</th>
                <th className="px-4 py-3">Location</th>
                {near && <th className="px-4 py-3 text-right">Distance</th>}
                <th className="px-4 py-3 text-right">Competitors</th>
                <th className="px-4 py-3">Registration</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {result.competitions.map((competition) => {
                const status = statusInfo(competition.registration_status);
                return (
                  <tr key={competition.id} className="hover:bg-gray-50">
                    <td className="whitespace-nowrap px-4 py-3 text-gray-600">
                      {formatDateRange(competition.start_date, competition.end_date)}
                    </td>
                    <td className="px-4 py-3">
                      <a
                        href={`${WCA_ORIGIN}/competitions/${competition.id}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-medium text-blue-600 hover:underline"
                      >
                        {competition.name}
                      </a>
                      {competition.championships.length > 0 && (
                        <div className="mt-1 flex flex-wrap gap-1">
                          {competition.championships.map((championship) => (
                            <span
                              key={championship.type}
                              className="rounded bg-purple-100 px-1.5 py-0.5 text-xs font-medium text-purple-800"
                            >
                              Championship: {championship.name}
                            </span>
                          ))}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-gray-600">
                      {competition.city}, {competition.country_name}
                    </td>
                    {near && (
                      <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums text-gray-600">
                        {competition.distance_km === null ? "—" : `${competition.distance_km.toLocaleString()} km`}
                      </td>
                    )}
                    <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums text-gray-600">
                      {competitorsLabel(competition)}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">
                      <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${status.badge}`}>
                        {status.label}
                      </span>
                      <div className="mt-1 text-xs text-gray-500">{registrationDetail(competition)}</div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
