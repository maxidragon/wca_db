import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { backendRequest } from "../../utils/request";
import { formatDate } from "../../utils/results";
import { SegmentedControl, StatTile, WCA_ORIGIN } from "./components";
import { CompetitionsTable, StaffedTable } from "./CompetitionTables";
import Overview from "./Overview";
import PersonResults from "./PersonResults";
import {
  RESULT_GROUPINGS,
  type PersonProfile,
  type ResultGrouping,
  type ResultsState,
} from "./types";

const TABS = ["overview", "results", "competitions", "delegated", "organized"] as const;
type Tab = (typeof TABS)[number];

const TAB_LABELS: Record<Tab, string> = {
  overview: "Overview",
  results: "Results",
  competitions: "Competitions",
  delegated: "Delegated",
  organized: "Organized",
};

/** Loads the competitor's results the first time they are asked for, then keeps them. */
function usePersonResults(wcaId: string, wanted: boolean): ResultsState {
  const [state, setState] = useState<ResultsState>({ results: null, error: null });
  const loaded = state.results !== null || state.error !== null;

  useEffect(() => {
    if (!wanted || loaded) return;
    const request = new AbortController();
    (async () => {
      try {
        const res = await backendRequest(
          `api/person/results?wca_id=${wcaId}`,
          "GET",
          true,
          undefined,
          request.signal,
        );
        const data = await res.json();
        if (res.ok) setState({ results: data.results, error: null });
        else setState({ results: null, error: data.error || "Unknown error" });
      } catch (err) {
        if (!request.signal.aborted)
          setState({
            results: null,
            error: err instanceof Error ? err.message : "Could not load the results",
          });
      }
    })();
    return () => request.abort();
  }, [wcaId, wanted, loaded]);

  return state;
}

export default function PersonProfileView({ profile }: { profile: PersonProfile }) {
  const { person, totals } = profile;
  const [searchParams, setSearchParams] = useSearchParams();
  const tab: Tab = TABS.find((option) => option === searchParams.get("tab")) ?? "overview";
  const grouping: ResultGrouping =
    RESULT_GROUPINGS.find((option) => option === searchParams.get("by")) ?? "event";
  const eventId = searchParams.get("event");
  const results = usePersonResults(person.wca_id, tab === "results");

  // The tab, grouping and event live in the URL so a shared link opens on what it names.
  // Each is left out at its default.
  const updateParams = (changes: Record<string, string | null>) => {
    const params = new URLSearchParams(searchParams);
    for (const [key, value] of Object.entries(changes)) {
      if (value === null) params.delete(key);
      else params.set(key, value);
    }
    setSearchParams(params, { replace: true });
  };
  const selectTab = (next: Tab) =>
    updateParams({
      tab: next === "overview" ? null : next,
      ...(next === "results" ? {} : { by: null, event: null }),
    });

  const tabOptions = TABS.map((option) => ({
    value: option,
    label: TAB_LABELS[option],
    count:
      option === "competitions" || option === "delegated" || option === "organized"
        ? profile[option].length
        : undefined,
  }));

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-gray-900">
          <a
            href={`${WCA_ORIGIN}/persons/${person.wca_id}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-600 hover:underline"
          >
            {person.name}
          </a>
        </h2>
        <p className="text-sm text-gray-500">
          {person.wca_id} · {person.country_name} · {person.continent_name}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile
          label="Competitions"
          value={String(totals.competitions)}
          hint={
            totals.first_competition_date
              ? `since ${formatDate(totals.first_competition_date)}`
              : undefined
          }
        />
        <StatTile label="Countries" value={String(totals.countries)} hint="competed in" />
        <StatTile label="Events" value={String(totals.events)} hint="competed in" />
        <StatTile
          label="Solves"
          value={String(totals.solves)}
          hint={`${totals.attempts - totals.solves} DNF/DNS of ${totals.attempts} attempts`}
        />
        <StatTile
          label="Medals"
          value={`${totals.gold} / ${totals.silver} / ${totals.bronze}`}
          hint="gold / silver / bronze"
        />
        <StatTile
          label="Records"
          value={`${totals.world_records} / ${totals.continental_records} / ${totals.national_records}`}
          hint="world / continental / national"
        />
        <StatTile
          label="Longest PR streak"
          value={String(totals.longest_personal_record_streak)}
          hint="competitions in a row with a PR"
        />
        <StatTile
          label="Last competition"
          value={
            totals.last_competition_date ? formatDate(totals.last_competition_date) : "—"
          }
        />
      </div>

      <div className="border-b border-gray-200 pb-2">
        <SegmentedControl
          role="tablist"
          label="Profile sections"
          options={tabOptions}
          value={tab}
          onChange={selectTab}
        />
      </div>

      <div role="tabpanel">
        {tab === "overview" && <Overview profile={profile} />}
        {tab !== "overview" && (
          <section className="rounded-lg border border-gray-200 bg-white">
            {tab === "results" && (
              <PersonResults
                state={results}
                grouping={grouping}
                onGroupingChange={(next) =>
                  updateParams({ by: next === "event" ? null : next })
                }
                eventId={eventId}
                onEventChange={(next) => updateParams({ event: next })}
              />
            )}
            {tab === "competitions" && (
              <CompetitionsTable competitions={profile.competitions} />
            )}
            {tab === "delegated" && (
              <StaffedTable
                competitions={profile.delegated}
                emptyMessage="This person has not delegated a competition."
              />
            )}
            {tab === "organized" && (
              <StaffedTable
                competitions={profile.organized}
                emptyMessage="This person has not organized a competition."
              />
            )}
          </section>
        )}
      </div>
    </div>
  );
}
