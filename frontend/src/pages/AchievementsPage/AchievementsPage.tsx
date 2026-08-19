import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { backendRequest } from "../../utils/request";

const WCA_ORIGIN = "https://www.worldcubeassociation.org";

interface Competition {
  id: string;
  name: string;
  start_date: string;
  end_date: string;
  country_id: string;
}

interface PersonMilestone {
  wca_id: string;
  name: string;
  milestone: number;
}

interface AttemptMilestone extends PersonMilestone {
  count_before: number;
  count_after: number;
  estimated: boolean;
}

interface TogetherMilestone {
  person1: { wca_id: string; name: string };
  person2: { wca_id: string; name: string };
  milestone: number;
}

interface AchievementsResult {
  competition: Competition;
  projected: boolean;
  roster_size: number;
  competition_milestones: PersonMilestone[];
  delegate_milestones: PersonMilestone[];
  successful_attempt_milestones: AttemptMilestone[];
  together_milestones: TogetherMilestone[];
  methodology: string;
}

function formatDate(value: string): string {
  return new Date(`${value.slice(0, 10)}T00:00:00Z`).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

function PersonLink({ wcaId, name }: { wcaId: string; name: string }) {
  return (
    <a
      href={`${WCA_ORIGIN}/persons/${wcaId}`}
      target="_blank"
      rel="noopener noreferrer"
      className="font-medium text-blue-600 hover:underline"
    >
      {name}
    </a>
  );
}

function EmptySection({ projected }: { projected: boolean }) {
  return (
    <p className="py-5 text-sm text-gray-500">
      No {projected ? "likely milestones" : "milestones"} found.
    </p>
  );
}

function MilestoneSection({
  title,
  description,
  items,
  projected,
}: {
  title: string;
  description: string;
  items: PersonMilestone[];
  projected: boolean;
}) {
  return (
    <section className="rounded-xl border border-gray-200 bg-white shadow-sm">
      <div className="border-b border-gray-100 px-5 py-4">
        <h3 className="font-semibold text-gray-900">{title}</h3>
        <p className="mt-1 text-sm text-gray-500">{description}</p>
      </div>
      <div className="divide-y divide-gray-100 px-5">
        {items.length === 0 ? (
          <EmptySection projected={projected} />
        ) : (
          items.map((item) => (
            <div key={`${item.wca_id}-${item.milestone}`} className="flex items-center justify-between gap-4 py-3">
              <div>
                <PersonLink wcaId={item.wca_id} name={item.name} />
                <p className="text-xs text-gray-400">{item.wca_id}</p>
              </div>
              <span className="shrink-0 rounded-full bg-blue-50 px-3 py-1 text-sm font-semibold text-blue-700">
                {item.milestone.toLocaleString()}
              </span>
            </div>
          ))
        )}
      </div>
    </section>
  );
}

export default function AchievementsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const initialId = searchParams.get("competition_id") || "";
  const [query, setQuery] = useState(initialId);
  const [suggestions, setSuggestions] = useState<Competition[]>([]);
  const [result, setResult] = useState<AchievementsResult | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const searchVersion = useRef(0);

  const loadAchievements = async (competitionId: string) => {
    setIsLoading(true);
    setError(null);
    setSuggestions([]);
    setSearchOpen(false);
    try {
      const response = await backendRequest(
        `api/achievements?competition_id=${encodeURIComponent(competitionId)}`,
        "GET",
        true
      );
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not load achievements");
      setResult(data);
      setQuery(data.competition.name);
      setSearchParams({ competition_id: data.competition.id });
    } catch (loadError) {
      setResult(null);
      setError(loadError instanceof Error ? loadError.message : "Could not load achievements");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (initialId) void loadAchievements(initialId);
    // The URL is only used to initialize the page. Further updates happen in loadAchievements.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
          `api/competitions/search?q=${encodeURIComponent(trimmed)}`,
          "GET",
          true
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

  const submitSearch = (event: React.FormEvent) => {
    event.preventDefault();
    const trimmed = query.trim();
    const exact = suggestions.find(
      (competition) => competition.id.toLowerCase() === trimmed.toLowerCase()
    );
    if (exact) {
      void loadAchievements(exact.id);
    } else if (/^[a-z0-9_-]*\d{4}$/i.test(trimmed)) {
      void loadAchievements(trimmed);
    } else if (suggestions.length === 1) {
      void loadAchievements(suggestions[0].id);
    } else {
      setSearchOpen(true);
    }
  };

  return (
    <div className="mx-auto max-w-5xl p-4">
      <h2 className="text-2xl font-bold text-gray-900">Competition Achievements</h2>
      <p className="mt-1 text-sm text-gray-500">
        See milestone moments from a completed competition or projections for an upcoming one.
      </p>

      <form onSubmit={submitSearch} className="relative mt-6 max-w-2xl">
        <div className="flex gap-2">
          <div className="relative flex-1">
            <input
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setSearchOpen(true);
              }}
              onFocus={() => setSearchOpen(true)}
              placeholder="Search by competition name or ID"
              className="w-full rounded-lg border border-gray-300 bg-white px-4 py-2.5 pr-10 focus:outline-none focus:ring-2 focus:ring-blue-400"
            />
            {isSearching && (
              <div className="absolute right-3 top-3 h-5 w-5 animate-spin rounded-full border-2 border-blue-500 border-t-transparent" />
            )}
          </div>
          <button
            type="submit"
            disabled={isLoading || query.trim().length < 2}
            className="rounded-lg bg-blue-500 px-5 py-2.5 text-white hover:bg-blue-600 disabled:cursor-not-allowed disabled:bg-gray-400"
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
                onClick={() => void loadAchievements(competition.id)}
                className="flex w-full items-center justify-between gap-4 border-b border-gray-100 px-4 py-3 text-left last:border-0 hover:bg-blue-50"
              >
                <span>
                  <span className="block text-sm font-medium text-gray-800">{competition.name}</span>
                  <span className="block text-xs text-gray-400">{competition.id}</span>
                </span>
                <span className="shrink-0 text-xs text-gray-500">{formatDate(competition.start_date)}</span>
              </button>
            ))}
          </div>
        )}
      </form>

      {isLoading && (
        <div className="flex justify-center py-16">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-blue-500 border-t-transparent" />
        </div>
      )}
      {error && !isLoading && <p className="mt-8 rounded-lg bg-red-50 p-4 text-red-700">{error}</p>}

      {result && !isLoading && (
        <div className="mt-8">
          <div className="mb-6 rounded-xl bg-slate-800 px-5 py-5 text-white shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <a
                  href={`${WCA_ORIGIN}/competitions/${result.competition.id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xl font-semibold hover:underline"
                >
                  {result.competition.name}
                </a>
                <p className="mt-1 text-sm text-slate-300">
                  {formatDate(result.competition.start_date)} · {result.roster_size.toLocaleString()} {result.projected ? "accepted registrations" : "competitors"}
                </p>
              </div>
              <span className={`rounded-full px-3 py-1 text-sm font-medium ${result.projected ? "bg-amber-400/20 text-amber-200" : "bg-emerald-400/20 text-emerald-200"}`}>
                {result.projected ? "Projected" : "Completed"}
              </span>
            </div>
          </div>

          <div className="grid gap-5 md:grid-cols-2">
            <MilestoneSection
              title="Competitions attended"
              description={`${result.projected ? "Likely to attend" : "Completed"} their 100th, 150th, … or 400th competition here.`}
              items={result.competition_milestones}
              projected={result.projected}
            />
            <MilestoneSection
              title="Competitions delegated"
              description={`${result.projected ? "Likely to delegate" : "Delegated"} their 100th, 150th, … or 400th competition here.`}
              items={result.delegate_milestones}
              projected={result.projected}
            />

            <section className="rounded-xl border border-gray-200 bg-white shadow-sm">
              <div className="border-b border-gray-100 px-5 py-4">
                <h3 className="font-semibold text-gray-900">Successful attempts</h3>
                <p className="mt-1 text-sm text-gray-500">Crossed a major successful-attempt milestone at this competition.</p>
              </div>
              <div className="divide-y divide-gray-100 px-5">
                {result.successful_attempt_milestones.length === 0 ? (
                  <EmptySection projected={result.projected} />
                ) : (
                  result.successful_attempt_milestones.map((item) => (
                    <div key={`${item.wca_id}-${item.milestone}`} className="flex items-center justify-between gap-4 py-3">
                      <div>
                        <PersonLink wcaId={item.wca_id} name={item.name} />
                        <p className="text-xs text-gray-400">
                          {item.estimated ? "Estimated " : ""}{item.count_before.toLocaleString()} → {item.count_after.toLocaleString()}
                        </p>
                      </div>
                      <span className="shrink-0 rounded-full bg-violet-50 px-3 py-1 text-sm font-semibold text-violet-700">
                        {item.milestone.toLocaleString()}
                      </span>
                    </div>
                  ))
                )}
              </div>
            </section>

            <section className="rounded-xl border border-gray-200 bg-white shadow-sm">
              <div className="border-b border-gray-100 px-5 py-4">
                <h3 className="font-semibold text-gray-900">Competitions together</h3>
                <p className="mt-1 text-sm text-gray-500">Pairs reaching their 100th, 150th, or 200th shared competition.</p>
              </div>
              <div className="divide-y divide-gray-100 px-5">
                {result.together_milestones.length === 0 ? (
                  <EmptySection projected={result.projected} />
                ) : (
                  result.together_milestones.map((item) => (
                    <div key={`${item.person1.wca_id}-${item.person2.wca_id}-${item.milestone}`} className="flex items-center justify-between gap-4 py-3">
                      <div className="text-sm">
                        <PersonLink wcaId={item.person1.wca_id} name={item.person1.name} />
                        <span className="text-gray-400"> &amp; </span>
                        <PersonLink wcaId={item.person2.wca_id} name={item.person2.name} />
                      </div>
                      <span className="shrink-0 rounded-full bg-teal-50 px-3 py-1 text-sm font-semibold text-teal-700">
                        {item.milestone.toLocaleString()}
                      </span>
                    </div>
                  ))
                )}
              </div>
            </section>
          </div>

          <p className="mt-5 text-xs leading-relaxed text-gray-500">{result.methodology}</p>
        </div>
      )}
    </div>
  );
}
