import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { backendRequest } from "../../utils/request";

const WCA_ORIGIN = "https://www.worldcubeassociation.org";
const WCA_ID_RE = /^\d{4}[A-Z]{4}\d{2}$/;
const INVALID_ID_MESSAGE = "Invalid WCA ID format (expected e.g. 2009ZEMD01)";

const REGIONS = ["world", "continent", "country"] as const;
type Region = (typeof REGIONS)[number];

interface Nemesis {
  wca_id: string;
  name: string;
  country_id: string | null;
  country_name: string | null;
}

interface NemesesResult {
  person: {
    wca_id: string;
    name: string;
    country_id: string;
    country_name: string;
    continent_id: string;
    continent_name: string;
  };
  ranks: number;
  counts: Record<Region, number>;
  region: Region;
  page: number;
  page_size: number;
  nemeses: Nemesis[];
}

function parseRegion(value: string | null): Region {
  return REGIONS.includes(value as Region) ? (value as Region) : "world";
}

function regionLabel(region: Region, result: NemesesResult | null): string {
  if (region === "world") return "World";
  if (!result) return region === "continent" ? "Continent" : "Country";
  return region === "continent" ? result.person.continent_name : result.person.country_name;
}

const NemesesPage = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedId = (searchParams.get("wca_id") || "").trim().toUpperCase();
  const region = parseRegion(searchParams.get("region"));
  const page = Math.max(1, Number(searchParams.get("page")) || 1);
  const [wcaId, setWcaId] = useState(requestedId);
  const [result, setResult] = useState<NemesesResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  // The list follows the URL, so a shared link, the region and the page all load what they name.
  useEffect(() => {
    setWcaId(requestedId);
    if (!requestedId) {
      setResult(null);
      setError(null);
      return;
    }
    if (!WCA_ID_RE.test(requestedId)) {
      setResult(null);
      setError(INVALID_ID_MESSAGE);
      return;
    }

    const request = new AbortController();
    setError(null);
    setIsLoading(true);
    (async () => {
      try {
        const res = await backendRequest(
          `api/nemeses?wca_id=${requestedId}&region=${region}&page=${page}`,
          "GET",
          true,
          undefined,
          request.signal,
        );
        const data = await res.json();
        if (res.ok) setResult(data);
        else {
          setResult(null);
          setError(data.error || "Unknown error");
        }
      } catch (err) {
        if (!request.signal.aborted) {
          setResult(null);
          setError(err instanceof Error ? err.message : "Could not load the nemeses");
        }
      } finally {
        if (!request.signal.aborted) setIsLoading(false);
      }
    })();
    return () => request.abort();
  }, [requestedId, region, page]);

  const update = (changes: Record<string, string | null>) => {
    const next = new URLSearchParams(searchParams);
    for (const [key, value] of Object.entries(changes)) {
      if (value === null) next.delete(key);
      else next.set(key, value);
    }
    setSearchParams(next);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const id = wcaId.trim().toUpperCase();
    if (!WCA_ID_RE.test(id)) {
      setError(INVALID_ID_MESSAGE);
      return;
    }
    update({ wca_id: id, page: null });
  };

  // The counts belong to the competitor, not the region, so they stay while a region loads.
  const shown = result && result.person.wca_id === requestedId ? result : null;
  const total = shown ? shown.counts[region] : 0;
  const pages = shown ? Math.max(1, Math.ceil(total / shown.page_size)) : 1;

  return (
    <div className="mx-auto max-w-5xl p-4">
      <h2 className="mb-1 text-2xl font-bold">Nemeses</h2>
      <p className="mb-6 text-sm text-gray-500">
        Everyone with a better official world rank than a competitor in every event they have
        a rank in, on both single and average.
      </p>

      <form onSubmit={handleSubmit} className="mb-6 flex flex-col gap-3 sm:flex-row">
        <input
          className="flex-1 rounded border border-gray-300 p-2 uppercase focus:outline-none focus:ring-2 focus:ring-blue-400"
          placeholder="WCA ID (e.g. 2009ZEMD01)"
          value={wcaId}
          onChange={(e) => setWcaId(e.target.value.toUpperCase())}
          spellCheck={false}
        />
        <button
          type="submit"
          disabled={isLoading}
          className="shrink-0 cursor-pointer rounded bg-blue-500 px-4 py-2 text-white hover:bg-blue-600 disabled:cursor-not-allowed disabled:bg-gray-400"
        >
          {isLoading ? "Searching…" : "Search"}
        </button>
      </form>

      <div className="mb-6 inline-flex rounded-lg border border-gray-300 bg-white p-1 text-sm">
        {REGIONS.map((option) => (
          <button
            key={option}
            type="button"
            onClick={() => update({ region: option === "world" ? null : option, page: null })}
            className={`cursor-pointer rounded px-3 py-1.5 font-medium transition-colors ${
              option === region
                ? "bg-blue-100 text-blue-700"
                : "text-gray-600 hover:bg-gray-100 hover:text-gray-900"
            }`}
          >
            {regionLabel(option, shown)}
            {shown && (
              <span className="ml-1.5 text-xs text-gray-500">
                {shown.counts[option].toLocaleString()}
              </span>
            )}
          </button>
        ))}
      </div>

      {isLoading && (
        <div className="my-8 flex justify-center">
          <div className="h-6 w-6 animate-spin rounded-full border-4 border-blue-500 border-t-transparent" />
        </div>
      )}

      {error && !isLoading && <p className="text-red-500">{error}</p>}

      {shown && !isLoading && !error && (
        <div>
          <p className="mb-4 text-sm text-gray-500">
            Nemeses of{" "}
            <a
              href={`${WCA_ORIGIN}/persons/${shown.person.wca_id}`}
              target="_blank"
              rel="noopener noreferrer"
              className="font-semibold text-blue-600 hover:underline"
            >
              {shown.person.name}
            </a>
            {shown.ranks > 0 && (
              <> across {shown.ranks} ranked singles and averages</>
            )}
            .
          </p>

          {shown.ranks === 0 ? (
            <p className="text-gray-600">
              This competitor has no official ranks yet, so nobody can beat them in every one.
            </p>
          ) : total === 0 ? (
            <p className="text-gray-600">
              Nobody {region === "world" ? "in the world" : `from ${regionLabel(region, shown)}`}{" "}
              beats this competitor in every event. No nemeses!
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
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {shown.nemeses.map((nemesis, index) => (
                      <tr key={nemesis.wca_id} className="transition-colors hover:bg-gray-50">
                        <td className="px-4 py-2 text-right text-gray-500">
                          {(shown.page - 1) * shown.page_size + index + 1}
                        </td>
                        <td className="px-4 py-2">
                          <a
                            href={`${WCA_ORIGIN}/persons/${nemesis.wca_id}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-blue-600 hover:underline"
                          >
                            {nemesis.name}
                          </a>
                        </td>
                        <td className="px-4 py-2 font-mono text-gray-600">{nemesis.wca_id}</td>
                        <td className="px-4 py-2 text-gray-600">
                          {nemesis.country_name ?? "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm text-gray-600">
                <span>
                  {total.toLocaleString()} nemeses · Page {shown.page} of {pages}
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
          )}
        </div>
      )}
    </div>
  );
};

export default NemesesPage;
