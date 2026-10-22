import { useState } from "react";
import {
  formatLimit,
  isTimed,
  limitHint,
  reformatTimeInput,
  parseLimit,
  type CustomRequirement,
  type EventOption,
  type ResultType,
} from "./requirements";

interface Row {
  key: number;
  eventId: string;
  resultType: ResultType;
  kind: "limit" | "any";
  value: string;
}

let nextKey = 0;

function toRow({ eventId, resultType, level }: CustomRequirement): Row {
  return {
    key: nextKey++,
    eventId,
    resultType,
    kind: level === null ? "any" : "limit",
    value: level === null ? "" : formatLimit(eventId, resultType, level),
  };
}

// Blindfolded events have means, but their requirements are almost always on the single.
const BLINDFOLDED = new Set(["333bf", "444bf", "555bf", "333mbf"]);

/** Average where the event is decided by averages, single for blindfolded and the rest. */
function defaultResultType(event: EventOption | undefined): ResultType {
  if (!event || BLINDFOLDED.has(event.id) || !event.has_average) return "single";
  return "average";
}

const fieldClass =
  "rounded border border-gray-300 bg-white px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400";

/**
 * Builds a set of requirements: one per event, each a limit to beat or any successful result,
 * all with one optional deadline. Starts from the set in the URL, so a shared link can be edited.
 */
export default function CustomRequirementsForm({
  events,
  initial,
  initialDeadline,
  disabled,
  onSubmit,
}: {
  events: EventOption[];
  initial: CustomRequirement[];
  initialDeadline: string;
  disabled: boolean;
  onSubmit: (requirements: CustomRequirement[], deadline: string) => void;
}) {
  const newRow = (eventId: string): Row => ({
    key: nextKey++,
    eventId,
    resultType: defaultResultType(events.find((event) => event.id === eventId)),
    kind: "limit",
    value: "",
  });
  const [rows, setRows] = useState<Row[]>(() =>
    initial.length > 0 ? initial.map(toRow) : [newRow("333")],
  );
  const [deadline, setDeadline] = useState(initialDeadline);
  const [errors, setErrors] = useState<Record<number, string>>({});

  const hasAverage = (eventId: string) =>
    events.find((event) => event.id === eventId)?.has_average ?? true;
  const change = (key: number, changes: Partial<Row>) =>
    setRows((current) =>
      current.map((row) => {
        if (row.key !== key) return row;
        const next = { ...row, ...changes };
        // An event without averages, like multi-blind, can only ask for a single.
        if (!hasAverage(next.eventId)) next.resultType = "single";
        return next;
      }),
    );
  const unusedEvent = () =>
    events.find((event) => !rows.some((row) => row.eventId === event.id))?.id;

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const found: Record<number, string> = {};
    const requirements: CustomRequirement[] = [];
    const used = new Set<string>();
    for (const row of rows) {
      if (used.has(row.eventId)) {
        found[row.key] = "This event already has a requirement.";
        continue;
      }
      used.add(row.eventId);
      if (row.kind === "any") {
        requirements.push({ eventId: row.eventId, resultType: row.resultType, level: null });
        continue;
      }
      const level = parseLimit(row.eventId, row.resultType, row.value);
      if (level === null) found[row.key] = `Enter a limit as ${limitHint(row.eventId, row.resultType)}.`;
      else requirements.push({ eventId: row.eventId, resultType: row.resultType, level });
    }
    setErrors(found);
    if (Object.keys(found).length === 0) onSubmit(requirements, deadline);
  };

  return (
    <form onSubmit={submit} className="mb-6 rounded-lg border border-gray-200 bg-white p-4">
      <div className="flex flex-col gap-3">
        {rows.map((row) => (
          <div key={row.key}>
            <div className="flex flex-wrap items-center gap-2">
              <select
                aria-label="Event"
                value={row.eventId}
                onChange={(e) =>
                  // A limit is typed in the event's own units, so it does not carry over.
                  change(row.key, {
                    eventId: e.target.value,
                    resultType: defaultResultType(events.find((event) => event.id === e.target.value)),
                    value: "",
                  })
                }
                className={fieldClass}
              >
                {events.map((event) => (
                  <option key={event.id} value={event.id}>
                    {event.name}
                  </option>
                ))}
              </select>
              <select
                aria-label="Result type"
                value={row.resultType}
                onChange={(e) => change(row.key, { resultType: e.target.value as ResultType })}
                className={fieldClass}
              >
                <option value="single">Single</option>
                <option value="average" disabled={!hasAverage(row.eventId)}>
                  Average
                </option>
              </select>
              <select
                aria-label="Requirement"
                value={row.kind}
                onChange={(e) => change(row.key, { kind: e.target.value as Row["kind"] })}
                className={fieldClass}
              >
                <option value="limit">
                  {row.eventId === "333mbf" ? "at least" : "under"}
                </option>
                <option value="any">any successful result</option>
              </select>
              {row.kind === "limit" && (
                <input
                  aria-label="Limit"
                  inputMode={
                    row.eventId === "333fm" && row.resultType === "average" ? "decimal" : "numeric"
                  }
                  spellCheck={false}
                  value={row.value}
                  onChange={(e) =>
                    change(row.key, {
                      value: isTimed(row.eventId)
                        ? reformatTimeInput(e.target.value)
                        : e.target.value,
                    })
                  }
                  placeholder={limitHint(row.eventId, row.resultType)}
                  className={`${fieldClass} w-44`}
                />
              )}
              {rows.length > 1 && (
                <button
                  type="button"
                  onClick={() => setRows((current) => current.filter((r) => r.key !== row.key))}
                  className="cursor-pointer rounded px-2 py-1.5 text-sm text-gray-500 hover:bg-gray-100 hover:text-gray-900"
                >
                  Remove
                </button>
              )}
            </div>
            {errors[row.key] && <p className="mt-1 text-sm text-red-500">{errors[row.key]}</p>}
          </div>
        ))}
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            disabled={!unusedEvent()}
            onClick={() => {
              const eventId = unusedEvent();
              if (eventId) setRows((current) => [...current, newRow(eventId)]);
            }}
            className="cursor-pointer rounded border border-gray-300 bg-white px-3 py-1.5 text-sm hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Add event
          </button>
          <label className="flex items-center gap-2 text-sm text-gray-700">
            Results by
            <input
              type="date"
              aria-label="Deadline"
              value={deadline}
              onChange={(e) => setDeadline(e.target.value)}
              className={fieldClass}
            />
            <span className="text-gray-500">{deadline ? "" : "any date"}</span>
          </label>
        </div>
        <button
          type="submit"
          disabled={disabled}
          className="cursor-pointer rounded-lg bg-blue-500 px-5 py-2 text-white hover:bg-blue-600 disabled:cursor-not-allowed disabled:bg-gray-400"
        >
          Show qualifiers
        </button>
      </div>
    </form>
  );
}
