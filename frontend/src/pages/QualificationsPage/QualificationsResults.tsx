import { formatDate, formatResult } from "../../utils/results";
import {
  COMPETED_PRESETS,
  describeRequirement,
  UNIQUE_LIST,
  WORLD,
  type QualificationsResult,
  type Region,
} from "./requirements";

const WCA_ORIGIN = "https://www.worldcubeassociation.org";

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

/**
 * The region filter, a tab per checked event plus the unique list, and the selected list's page.
 * `current` holds the requirements, which stay while another list or region loads; `shown` is
 * only set once the page for the selected list and region has arrived.
 */
export default function QualificationsResults({
  current,
  shown,
  list,
  region,
  competed,
  regions,
  isLoading,
  error,
  update,
}: {
  current: QualificationsResult | null;
  shown: QualificationsResult | null;
  list: string;
  region: string;
  /** A competed preset id, a YYYY-MM-DD date, or empty for any time. */
  competed: string;
  regions: Region[];
  isLoading: boolean;
  error: string | null;
  update: (changes: Record<string, string | null>) => void;
}) {
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
    <>
      {current && current.events.length > 0 && (
        <>
          <div className="mb-3 flex flex-wrap items-center gap-x-6 gap-y-2">
          <label className="flex items-center gap-2 text-sm font-medium text-gray-700">
            Region
            <select
              aria-label="Region"
              value={region}
              onChange={(e) =>
                update({ region: e.target.value === WORLD ? null : e.target.value, page: null })
              }
              className="rounded border border-gray-300 bg-white px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-400"
            >
              <option value={WORLD}>World</option>
              {(["continent", "country"] as const).map((kind) => (
                <optgroup key={kind} label={kind === "continent" ? "Continents" : "Countries"}>
                  {regions
                    .filter((r) => r.kind === kind)
                    .map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.name}
                      </option>
                    ))}
                </optgroup>
              ))}
            </select>
            <span className="font-normal text-gray-500">by current nationality</span>
          </label>
          <label className="flex items-center gap-2 text-sm font-medium text-gray-700">
            Competed
            <select
              aria-label="Competed"
              value={
                competed === "" || COMPETED_PRESETS.some((preset) => preset.id === competed)
                  ? competed
                  : "date"
              }
              onChange={(e) => {
                const value = e.target.value;
                // A date starts from a year ago, which the field beside it then changes.
                const since = new Date();
                since.setFullYear(since.getFullYear() - 1);
                update({
                  competed:
                    value === ""
                      ? null
                      : value === "date"
                        ? since.toISOString().slice(0, 10)
                        : value,
                  page: null,
                });
              }}
              className="rounded border border-gray-300 bg-white px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-400"
            >
              <option value="">Any time</option>
              {COMPETED_PRESETS.map((preset) => (
                <option key={preset.id} value={preset.id}>
                  {preset.label}
                </option>
              ))}
              <option value="date">Since a date</option>
            </select>
            {/^\d{4}-\d{2}-\d{2}$/.test(competed) && (
              <input
                type="date"
                aria-label="Competed since"
                value={competed}
                onChange={(e) => e.target.value && update({ competed: e.target.value, page: null })}
                className="rounded border border-gray-300 bg-white px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-400"
              />
            )}
          </label>
          </div>

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
                {describeRequirement(selected.event_id, selected.requirement)},{" "}
                {selected.requirement.when_date
                  ? `in a competition ending by ${formatDate(selected.requirement.when_date)}.`
                  : "at any competition."}
              </p>
            ) : (
              <p>Everyone who meets at least one of the requirements listed per event.</p>
            )}
            {unchecked.length > 0 && (
              <p className="mt-1 text-gray-500">
                Not listed, because a top N requirement depends on who registers:{" "}
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
              ? "This competition only has top N requirements, which depend on who registers and are not listed."
              : region === WORLD && competed === ""
                ? "Nobody meets this requirement yet."
                : "Nobody matching these filters meets this requirement yet."}
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
    </>
  );
}
