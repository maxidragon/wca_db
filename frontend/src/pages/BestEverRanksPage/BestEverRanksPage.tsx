import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { backendRequest } from "../../utils/request";
import { formatDate, formatResult } from "../../utils/results";

const WCA_ORIGIN = "https://www.worldcubeassociation.org";
const WCA_ID_RE = /^\d{4}[A-Z]{4}\d{2}$/;

interface Rank {
  event_id: string;
  event_name: string;
  result_type: "single" | "average";
  region_type: "world" | "continent" | "country";
  region_id: string;
  region_name: string;
  best_rank: number;
  result: number;
  competition_id: string;
  competition_name: string | null;
  start_date: string;
  end_date: string | null;
}

interface Result {
  person: { wca_id: string; name: string };
  ranks: Rank[];
}

function groupByEvent(ranks: Rank[]): { id: string; name: string; ranks: Rank[] }[] {
  const events: { id: string; name: string; ranks: Rank[] }[] = [];
  for (const rank of ranks) {
    let event = events[events.length - 1];
    if (!event || event.id !== rank.event_id) {
      event = { id: rank.event_id, name: rank.event_name, ranks: [] };
      events.push(event);
    }
    event.ranks.push(rank);
  }
  return events;
}

const BestEverRanksPage = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const [wcaId, setWcaId] = useState(searchParams.get("wca_id") || "");
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const id = wcaId.trim().toUpperCase();

    if (!WCA_ID_RE.test(id)) {
      setError("Invalid WCA ID format (expected e.g. 2009ZEMD01)");
      return;
    }

    setIsLoading(true);
    setError(null);
    setResult(null);
    setSearchParams({ wca_id: id });

    try {
      const res = await backendRequest(`api/best-ever-ranks?wca_id=${id}`, "GET", true);
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Unknown error");
      } else {
        setResult(data);
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="max-w-5xl mx-auto p-4">
      <h2 className="text-2xl font-bold mb-1">Best Ever Ranks</h2>
      <p className="text-gray-500 text-sm mb-6">
        The best world, continental and national rank a competitor has ever held, for
        every event they have competed in.
      </p>

      <form onSubmit={handleSubmit} className="flex flex-col sm:flex-row gap-3 mb-8">
        <input
          className="flex-1 p-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-400 uppercase"
          placeholder="WCA ID (e.g. 2009ZEMD01)"
          value={wcaId}
          onChange={(e) => setWcaId(e.target.value.toUpperCase())}
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
            Best ever ranks of{" "}
            <a
              href={`${WCA_ORIGIN}/persons/${result.person.wca_id}`}
              target="_blank"
              rel="noopener noreferrer"
              className="font-semibold text-blue-600 hover:underline"
            >
              {result.person.name}
            </a>
            .
          </p>

          {result.ranks.length === 0 ? (
            <p className="text-gray-600">This competitor has no results yet.</p>
          ) : (
            <div className="space-y-6">
              {groupByEvent(result.ranks).map((event) => (
                <div
                  key={event.id}
                  className="overflow-x-auto rounded-lg border border-gray-200 bg-white"
                >
                  <h3 className="px-4 py-3 font-semibold text-gray-700 border-b border-gray-100">
                    {event.name}
                  </h3>
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 text-gray-500 uppercase text-xs">
                      <tr>
                        <th className="px-4 py-2 text-left">Type</th>
                        <th className="px-4 py-2 text-left">Region</th>
                        <th className="px-4 py-2 text-right">Best rank</th>
                        <th className="px-4 py-2 text-right">Result</th>
                        <th className="px-4 py-2 text-left whitespace-nowrap">Held</th>
                        <th className="px-4 py-2 text-left">Competition</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {event.ranks.map((rank) => (
                        <tr
                          key={`${rank.result_type}-${rank.region_type}-${rank.region_id}`}
                          className="hover:bg-gray-50 transition-colors"
                        >
                          <td className="px-4 py-2 capitalize text-gray-600">
                            {rank.result_type}
                          </td>
                          <td className="px-4 py-2 text-gray-600">{rank.region_name}</td>
                          <td className="px-4 py-2 text-right font-semibold text-gray-900">
                            {rank.best_rank}
                          </td>
                          <td className="px-4 py-2 text-right whitespace-nowrap">
                            {formatResult(rank.result, rank.event_id, rank.result_type)}
                          </td>
                          <td className="px-4 py-2 text-gray-500 whitespace-nowrap">
                            {formatDate(rank.start_date)}
                            {rank.end_date ? (
                              <> – {formatDate(rank.end_date)}</>
                            ) : (
                              <span className="ml-2 rounded bg-green-100 px-1.5 py-0.5 text-xs font-medium text-green-700">
                                still held
                              </span>
                            )}
                          </td>
                          <td className="px-4 py-2">
                            <a
                              href={`${WCA_ORIGIN}/competitions/${rank.competition_id}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-blue-600 hover:underline"
                            >
                              {rank.competition_name || rank.competition_id}
                            </a>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default BestEverRanksPage;
