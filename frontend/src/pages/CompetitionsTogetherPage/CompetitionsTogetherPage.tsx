import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { backendRequest } from "../../utils/request";

const WCA_ORIGIN = "https://www.worldcubeassociation.org";
const WCA_ID_RE = /^\d{4}[A-Z]{4}\d{2}$/;

interface Person {
  wca_id: string;
  name: string;
}

interface Competition {
  id: string;
  name: string;
  start_date: string | null;
}

interface Podium {
  competition_id: string;
  competition_name: string;
  start_date: string | null;
  event_id: string;
  event_name: string;
  pos1: number;
  pos2: number;
}

interface Result {
  person1: Person;
  person2: Person;
  competitions: Competition[];
  podiums: Podium[];
}

const TABS = ["competitions", "podiums"] as const;
type Tab = (typeof TABS)[number];

function formatDate(date: string | null): string {
  if (!date) return "";
  return new Date(date).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

const CompetitionsTogetherPage = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const [id1, setId1] = useState(searchParams.get("wca_id1") || "");
  const [id2, setId2] = useState(searchParams.get("wca_id2") || "");
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const tab: Tab = searchParams.get("tab") === "podiums" ? "podiums" : "competitions";

  // The tab lives in the URL so a shared link opens on the list it names.
  const selectTab = (next: Tab) => {
    const params = new URLSearchParams(searchParams);
    if (next === "competitions") params.delete("tab");
    else params.set("tab", next);
    setSearchParams(params, { replace: true });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const v1 = id1.trim().toUpperCase();
    const v2 = id2.trim().toUpperCase();

    if (!WCA_ID_RE.test(v1) || !WCA_ID_RE.test(v2)) {
      setError("Invalid WCA ID format (expected e.g. 2009ZEMD01)");
      return;
    }

    setIsLoading(true);
    setError(null);
    setResult(null);
    setSearchParams({ wca_id1: v1, wca_id2: v2, ...(tab === "podiums" && { tab }) });

    try {
      const res = await backendRequest(
        `api/competitions-together?wca_id1=${v1}&wca_id2=${v2}`,
        "GET",
        true
      );
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Unknown error");
      } else {
        setResult(data);
      }
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not load the competitions",
      );
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto p-4">
      <h2 className="text-2xl font-bold mb-1">Competitions Together</h2>
      <p className="text-gray-500 text-sm mb-6">
        Find all competitions two WCA competitors have attended together.
      </p>

      <form onSubmit={handleSubmit} className="flex flex-col sm:flex-row gap-3 mb-8">
        <input
          className="flex-1 p-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-400 uppercase"
          placeholder="First WCA ID (e.g. 2012PARK03)"
          value={id1}
          onChange={(e) => setId1(e.target.value.toUpperCase())}
          spellCheck={false}
        />
        <input
          className="flex-1 p-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-400 uppercase"
          placeholder="Second WCA ID (e.g. 2009ZEMD01)"
          value={id2}
          onChange={(e) => setId2(e.target.value.toUpperCase())}
          spellCheck={false}
        />
        <button
          type="submit"
          disabled={isLoading}
          className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 disabled:bg-gray-400 disabled:cursor-not-allowed cursor-pointer shrink-0"
        >
          {isLoading ? "Searching…" : "Search"}
        </button>
      </form>

      {isLoading && (
        <div className="flex justify-center my-8">
          <div className="w-6 h-6 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
        </div>
      )}

      {error && !isLoading && <p className="text-red-500">{error}</p>}

      {result && !isLoading && (
        <div>
          <p className="mb-4 text-sm text-gray-500">
            <a
              href={`${WCA_ORIGIN}/persons/${result.person1.wca_id}`}
              target="_blank"
              rel="noopener noreferrer"
              className="font-semibold text-blue-600 hover:underline"
            >{result.person1.name}</a>
            {" & "}
            <a
              href={`${WCA_ORIGIN}/persons/${result.person2.wca_id}`}
              target="_blank"
              rel="noopener noreferrer"
              className="font-semibold text-blue-600 hover:underline"
            >{result.person2.name}</a>
            {" competed together at "}
            <span className="font-semibold text-gray-700">{result.competitions.length}</span>
            {result.competitions.length === 1 ? " competition." : " competitions."}
          </p>

          {result.competitions.length === 0 ? (
            <p className="text-gray-600">These two competitors have never competed together.</p>
          ) : (
            <>
              <div
                role="tablist"
                className="mb-6 inline-flex rounded-lg border border-gray-300 bg-white p-1 text-sm"
              >
                {TABS.map((option) => (
                  <button
                    key={option}
                    type="button"
                    role="tab"
                    aria-selected={option === tab}
                    onClick={() => selectTab(option)}
                    className={`cursor-pointer rounded px-3 py-1.5 font-medium transition-colors ${
                      option === tab
                        ? "bg-blue-100 text-blue-700"
                        : "text-gray-600 hover:bg-gray-100 hover:text-gray-900"
                    }`}
                  >
                    {option === "competitions" ? "Competitions" : "Podiums"}
                    <span className="ml-1.5 text-xs text-gray-500">
                      {(option === "competitions"
                        ? result.competitions.length
                        : result.podiums.length
                      ).toLocaleString()}
                    </span>
                  </button>
                ))}
              </div>

              {tab === "competitions" ? (
                <div role="tabpanel">
                  <h3 className="text-lg font-semibold mb-3">Competitions Together</h3>
                  <div className="overflow-x-auto rounded-lg border border-gray-200">
                    <table className="w-full text-sm">
                      <thead className="bg-gray-50 text-gray-500 uppercase text-xs">
                        <tr>
                          <th className="px-4 py-3 text-left">Competition</th>
                          <th className="px-4 py-3 text-right whitespace-nowrap">Date</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {result.competitions.map((comp) => (
                          <tr key={comp.id} className="hover:bg-gray-50 transition-colors">
                            <td className="px-4 py-3">
                              <a
                                href={`${WCA_ORIGIN}/competitions/${comp.id}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-blue-600 hover:underline"
                              >
                                {comp.name}
                              </a>
                            </td>
                            <td className="px-4 py-3 text-right text-gray-500 whitespace-nowrap">
                              {formatDate(comp.start_date)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ) : (
                <div role="tabpanel">
                  <h3 className="text-lg font-semibold mb-1">Podiums Together</h3>
                  <p className="mb-3 text-sm text-gray-500">
                    {"They shared "}
                    <span className="font-semibold text-gray-700">{result.podiums.length}</span>
                    {result.podiums.length === 1 ? " final podium." : " final podiums."}
                  </p>
                  {result.podiums.length > 0 && (
                    <div className="overflow-x-auto rounded-lg border border-gray-200">
                      <table className="w-full text-sm">
                        <thead className="bg-gray-50 text-gray-500 uppercase text-xs">
                          <tr>
                            <th className="px-4 py-3 text-left">Competition</th>
                            <th className="px-4 py-3 text-left">Event</th>
                            <th className="px-4 py-3 text-center" title={result.person1.wca_id}>
                              {result.person1.name}
                            </th>
                            <th className="px-4 py-3 text-center" title={result.person2.wca_id}>
                              {result.person2.name}
                            </th>
                            <th className="px-4 py-3 text-right whitespace-nowrap">Date</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                          {result.podiums.map((podium) => (
                            <tr
                              key={`${podium.competition_id}-${podium.event_id}`}
                              className="hover:bg-gray-50 transition-colors"
                            >
                              <td className="px-4 py-3">
                                <a
                                  href={`${WCA_ORIGIN}/competitions/${podium.competition_id}/results/podiums`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-blue-600 hover:underline"
                                >
                                  {podium.competition_name}
                                </a>
                              </td>
                              <td className="px-4 py-3">{podium.event_name}</td>
                              <td className="px-4 py-3 text-center">{podium.pos1}</td>
                              <td className="px-4 py-3 text-center">{podium.pos2}</td>
                              <td className="px-4 py-3 text-right text-gray-500 whitespace-nowrap">
                                {formatDate(podium.start_date)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
};

export default CompetitionsTogetherPage;
