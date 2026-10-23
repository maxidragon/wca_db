import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { backendRequest } from "../../utils/request";
import { getUserInfo } from "../../utils/wcaAuth";
import { formatDate } from "../../utils/results";
import CompetitionSearch from "./CompetitionSearch";
import CustomRequirementsForm from "./CustomRequirementsForm";
import QualificationsResults from "./QualificationsResults";
import SavedViews from "./SavedViews";
import {
  COMPETED_PRESETS,
  competedSinceDate,
  customFromCompetition,
  decodeCustom,
  encodeCustom,
  viewParams,
  UNIQUE_LIST,
  WORLD,
  type CustomRequirement,
  type EventOption,
  type QualificationsResult,
  type Region,
} from "./requirements";

const WCA_ORIGIN = "https://www.worldcubeassociation.org";
const CUSTOM_MODE = "custom";
// Pages already seen or fetched ahead, kept for the session; enough for every tab of a few
// competitions and filters. Lists only change with an import; the viewer's own row is the one
// part that depends on who asks, so pages are kept per logged-in account.
const CACHED_PAGES = 200;
// Tabs fetched ahead at once: quick enough to be ready before most clicks, without queuing
// a dozen requests in front of the one the user is waiting for.
const PREFETCH_CONCURRENCY = 3;
const pageCache = new Map<string, QualificationsResult>();
const inFlight = new Map<string, Promise<QualificationsResult>>();

/**
 * One page, from the cache, from a request already on its way, or from the backend. Sharing the
 * request means a tab clicked while it is being fetched ahead waits for that fetch, not another.
 */
function cacheKey(url: string): string {
  return `${getUserInfo()?.wcaUserId ?? ""}|${url}`;
}

function cachedPageFor(url: string): QualificationsResult | null {
  return pageCache.get(cacheKey(url)) ?? null;
}

function loadPage(url: string): Promise<QualificationsResult> {
  const key = cacheKey(url);
  const cached = pageCache.get(key);
  if (cached) return Promise.resolve(cached);
  let request = inFlight.get(key);
  if (!request) {
    request = (async () => {
      const res = await backendRequest(url, "GET", true);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Unknown error");
      pageCache.set(key, data);
      while (pageCache.size > CACHED_PAGES) pageCache.delete(pageCache.keys().next().value!);
      return data;
    })().finally(() => inFlight.delete(key));
    inFlight.set(key, request);
  }
  return request;
}

function pageUrl(
  source: string,
  list: string,
  region: string,
  competedSince: string | null,
  page: number,
): string {
  return `${source}&list=${encodeURIComponent(list)}&region=${encodeURIComponent(region)}${
    competedSince ? `&competed_since=${competedSince}` : ""
  }&page=${page}`;
}

const QualificationsPage = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const custom = searchParams.get("mode") === CUSTOM_MODE;
  const competitionId = (searchParams.get("competition_id") || "").trim();
  const requirements = searchParams.get("requirements") || "";
  const deadline = searchParams.get("deadline") || "";
  const list = searchParams.get("list") || UNIQUE_LIST;
  const region = searchParams.get("region") || WORLD;
  const competed = searchParams.get("competed") || "";
  const competedSince = competedSinceDate(competed);
  const page = Math.max(1, Number(searchParams.get("page")) || 1);
  // What the lists are of: one competition's requirements, or a custom set. A result belongs
  // to the source it was loaded for, so switching sources never shows the previous one's lists.
  const source = custom
    ? requirements &&
      `api/qualifications/custom?requirements=${encodeURIComponent(requirements)}${
        deadline ? `&deadline=${deadline}` : ""
      }`
    : competitionId && `api/qualifications?competition_id=${encodeURIComponent(competitionId)}`;

  const [result, setResult] = useState<{ source: string; data: QualificationsResult } | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [regions, setRegions] = useState<Region[]>([]);
  const [events, setEvents] = useState<EventOption[]>([]);
  // The competition whose requirements are open for editing; another competition closes the form.
  const [editing, setEditing] = useState<string | null>(null);
  const url = source ? pageUrl(source, list, region, competedSince, page) : "";
  // Read while rendering, so a page already here is drawn in the same frame as the click that
  // asked for it, instead of one frame later once an effect has stored it.
  const cachedPage = url ? cachedPageFor(url) : null;

  // The statistics already name every region and current event, the same way these filters do.
  useEffect(() => {
    (async () => {
      try {
        const res = await backendRequest("api/statistics/options", "GET", true);
        if (res.ok) {
          const options = await res.json();
          setRegions(options.regions);
          setEvents(options.events);
        }
      } catch {
        // Without the list the region filter offers only the world, which still works.
      }
    })();
  }, []);

  // The lists follow the URL, so a shared link, the selected list and the page all load what
  // they name.
  useEffect(() => {
    if (!url) {
      setResult(null);
      setError(null);
      return;
    }
    let cancelled = false;
    setError(null);
    setIsLoading(cachedPageFor(url) === null);
    loadPage(url)
      .then((data) => {
        if (!cancelled) setResult({ source, data });
      })
      .catch((err) => {
        if (cancelled) return;
        setResult(null);
        setError(err instanceof Error ? err.message : "Could not load the qualifications");
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [url, source]);

  const update = (changes: Record<string, string | null>) => {
    const next = new URLSearchParams(searchParams);
    for (const [key, value] of Object.entries(changes)) {
      if (value === null) next.delete(key);
      else next.set(key, value);
    }
    setSearchParams(next);
  };

  // A new source starts at the unique list's first page. The filters usually outlive it: a
  // national team checks one competition, or one set of limits, after another.
  const showSource = (params: Record<string, string>) =>
    setSearchParams({
      ...params,
      ...(region === WORLD ? {} : { region }),
      ...(competed ? { competed } : {}),
    });

  const loaded = result && result.source === source ? result.data : null;
  const current = cachedPage ?? loaded;
  const shown =
    cachedPage ??
    (loaded &&
    loaded.list === list &&
    loaded.region === region &&
    loaded.competed_since === competedSince
      ? loaded
      : null);

  // Once a competition or set has loaded, the first page of every other tab is fetched ahead,
  // a few at a time, so switching tabs swaps the list in one step instead of waiting on it.
  const tabs = current
    ? [UNIQUE_LIST, ...current.events.filter((e) => e.count !== null).map((e) => e.event_id)].join(",")
    : "";
  useEffect(() => {
    if (!source || !tabs) return;
    let cancelled = false;
    const queue = tabs
      .split(",")
      .map((tab) => pageUrl(source, tab, region, competedSince, 1))
      .filter((tabUrl) => cachedPageFor(tabUrl) === null);
    const fetchAhead = async () => {
      while (!cancelled && queue.length > 0) {
        // Best effort: a tab that fails here loads, and reports its error, when picked.
        await loadPage(queue.shift()!).catch(() => undefined);
      }
    };
    for (let i = 0; i < PREFETCH_CONCURRENCY; i++) void fetchAhead();
    return () => {
      cancelled = true;
    };
  }, [source, tabs, region, competedSince]);

  // Pointing at a tab fetches it, in case it has not been fetched ahead yet.
  const prefetch = (tab: string) => {
    if (source) loadPage(pageUrl(source, tab, region, competedSince, 1)).catch(() => undefined);
  };

  // A saved view is named after what it shows; the name can be changed right after saving.
  const viewName = () => {
    if (!current) return "";
    const base = current.competition
      ? current.competition.name
      : current.events.map((event) => event.event_name).join(", ");
    const filters = [
      region === WORLD ? null : regions.find((r) => r.id === region)?.name ?? region,
      competed
        ? COMPETED_PRESETS.find((preset) => preset.id === competed)?.label.toLowerCase() ??
          `since ${competed}`
        : null,
    ].filter(Boolean);
    return filters.length > 0 ? `${base} (${filters.join(", ")})` : base;
  };

  const showCustom = (set: CustomRequirement[], until: string) =>
    showSource({
      mode: CUSTOM_MODE,
      requirements: encodeCustom(set),
      ...(until ? { deadline: until } : {}),
    });
  const editable =
    current?.competition && editing === current.competition.id
      ? customFromCompetition(current.events)
      : null;

  const modeClass = (active: boolean) =>
    `cursor-pointer rounded px-3 py-1.5 font-medium transition-colors ${
      active ? "bg-blue-100 text-blue-700" : "text-gray-600 hover:bg-gray-100 hover:text-gray-900"
    }`;

  return (
    <div className="mx-auto max-w-6xl p-4">
      <h2 className="mb-1 text-2xl font-bold">Qualifications</h2>
      <p className="mb-4 text-sm text-gray-500">
        Everyone who meets a competition's qualification requirements, or requirements you set,
        per event and as one list of unique competitors.
      </p>

      <SavedViews
        current={current ? viewParams(searchParams) : null}
        defaultName={viewName()}
        onOpen={(params) => setSearchParams(new URLSearchParams(params))}
      />

      <div className="mb-6 inline-flex rounded-lg border border-gray-300 bg-white p-1 text-sm">
        <button
          type="button"
          onClick={() => showSource({})}
          className={modeClass(!custom)}
        >
          Competition
        </button>
        <button
          type="button"
          onClick={() => showSource({ mode: CUSTOM_MODE })}
          className={modeClass(custom)}
        >
          Custom
        </button>
      </div>

      {custom ? (
        // Keyed by the URL's set, so going back in history refills the form with it.
        <CustomRequirementsForm
          key={`${requirements}|${deadline}|${events.length}`}
          events={events}
          initial={decodeCustom(requirements)}
          initialDeadline={deadline}
          disabled={isLoading || events.length === 0}
          onSubmit={showCustom}
        />
      ) : (
        <>
          <CompetitionSearch
            initialQuery={competitionId}
            selectedName={current?.competition?.name ?? null}
            disabled={isLoading}
            onSelect={(id) => showSource({ competition_id: id })}
          />
          {current?.competition && (
            <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
              <div>
                <a
                  href={`${WCA_ORIGIN}/competitions/${current.competition.id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xl font-semibold text-gray-900 hover:underline"
                >
                  {current.competition.name}
                </a>
                <p className="text-sm text-gray-500">
                  {formatDate(current.competition.start_date)}
                </p>
              </div>
              {!editable && (
                <button
                  type="button"
                  disabled={events.length === 0}
                  onClick={() => setEditing(current.competition!.id)}
                  className="cursor-pointer rounded border border-gray-300 bg-white px-3 py-1.5 text-sm hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Edit requirements
                </button>
              )}
            </div>
          )}
          {editable && (
            // Editing turns the competition's requirements into a custom set; its lists stay
            // shown until the edited set is submitted.
            <CustomRequirementsForm
              events={events}
              initial={editable.requirements}
              initialDeadline={editable.deadline}
              disabled={isLoading}
              onSubmit={showCustom}
              onCancel={() => setEditing(null)}
            />
          )}
        </>
      )}

      <QualificationsResults
        current={current}
        shown={shown}
        list={list}
        region={region}
        competed={competed}
        regions={regions}
        isLoading={isLoading && !cachedPage}
        prefetch={prefetch}
        error={error}
        update={update}
      />
    </div>
  );
};

export default QualificationsPage;
