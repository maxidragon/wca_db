import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { backendRequest } from "../../utils/request";
import { formatDate } from "../../utils/results";
import CompetitionSearch from "./CompetitionSearch";
import CustomRequirementsForm from "./CustomRequirementsForm";
import QualificationsResults from "./QualificationsResults";
import SavedViews from "./SavedViews";
import {
  COMPETED_PRESETS,
  competedSinceDate,
  decodeCustom,
  encodeCustom,
  viewParams,
  UNIQUE_LIST,
  WORLD,
  type EventOption,
  type QualificationsResult,
  type Region,
} from "./requirements";

const WCA_ORIGIN = "https://www.worldcubeassociation.org";
const CUSTOM_MODE = "custom";

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
    if (!source) {
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
          `${source}&list=${encodeURIComponent(list)}&region=${encodeURIComponent(region)}${
            competedSince ? `&competed_since=${competedSince}` : ""
          }&page=${page}`,
          "GET",
          true,
          undefined,
          request.signal,
        );
        const data = await res.json();
        if (res.ok) setResult({ source, data });
        else {
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
  }, [source, list, region, competedSince, page]);

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

  const current = result && result.source === source ? result.data : null;
  const shown =
    current &&
    current.list === list &&
    current.region === region &&
    current.competed_since === competedSince
      ? current
      : null;

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
          onSubmit={(set, until) =>
            showSource({
              mode: CUSTOM_MODE,
              requirements: encodeCustom(set),
              ...(until ? { deadline: until } : {}),
            })
          }
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
        </>
      )}

      <QualificationsResults
        current={current}
        shown={shown}
        list={list}
        region={region}
        competed={competed}
        regions={regions}
        isLoading={isLoading}
        error={error}
        update={update}
      />
    </div>
  );
};

export default QualificationsPage;
