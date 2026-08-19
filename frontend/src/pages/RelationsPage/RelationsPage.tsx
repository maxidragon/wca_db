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
}

interface RelationsResult {
  chain: Person[];
  connections: Competition[][];
}

const RelationsPage = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const [id1, setId1] = useState(searchParams.get("wca_id1") || "");
  const [id2, setId2] = useState(searchParams.get("wca_id2") || "");
  const [result, setResult] = useState<RelationsResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const v1 = id1.trim().toUpperCase();
    const v2 = id2.trim().toUpperCase();

    if (!WCA_ID_RE.test(v1) || !WCA_ID_RE.test(v2)) {
      setError("Invalid WCA ID format (expected e.g. 2003ZEMD01)");
      return;
    }

    setIsLoading(true);
    setError(null);
    setResult(null);
    setSearchParams({ wca_id1: v1, wca_id2: v2 });

    try {
      const res = await backendRequest(
        `api/relations?wca_id1=${v1}&wca_id2=${v2}`,
        "GET",
        true
      );
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

  const noRelation =
    result && result.chain.length === 0;
  const degrees =
    result && result.chain.length > 1 ? result.chain.length - 1 : null;

  return (
    <div className="max-w-2xl mx-auto p-4">
      <h2 className="text-2xl font-bold mb-1">Relations</h2>
      <p className="text-gray-500 text-sm mb-6">
        Find the shortest chain of competitors between two WCA IDs.
      </p>

      <form onSubmit={handleSubmit} className="flex flex-col sm:flex-row gap-3 mb-8">
        <input
          className="flex-1 p-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-400 uppercase"
          placeholder="First WCA ID (e.g. 2003ZEMD01)"
          value={id1}
          onChange={(e) => setId1(e.target.value.toUpperCase())}
          spellCheck={false}
        />
        <input
          className="flex-1 p-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-400 uppercase"
          placeholder="Second WCA ID (e.g. 2015GALA01)"
          value={id2}
          onChange={(e) => setId2(e.target.value.toUpperCase())}
          spellCheck={false}
        />
        <button
          type="submit"
          disabled={isLoading}
          className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 disabled:bg-gray-400 disabled:cursor-not-allowed cursor-pointer shrink-0"
        >
          {isLoading ? "Searching…" : "Find Relation"}
        </button>
      </form>

      {isLoading && (
        <div className="flex justify-center my-8">
          <div className="w-6 h-6 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
        </div>
      )}

      {error && !isLoading && (
        <p className="text-red-500">{error}</p>
      )}

      {noRelation && !isLoading && (
        <p className="text-gray-600">No relation found between these two competitors.</p>
      )}

      {result && result.chain.length > 0 && !isLoading && (
        <div>
          <p className="text-sm text-gray-500 mb-6">
            {degrees === 1
              ? "1 degree of separation"
              : `${degrees} degrees of separation`}
          </p>

          <div className="flex flex-col items-center gap-0">
            {result.chain.map((person, i) => (
              <div key={person.wca_id} className="flex flex-col items-center w-full max-w-sm">
                <div className="w-full bg-white border border-gray-200 rounded-lg shadow-sm px-5 py-3 text-center">
                  <a
                    href={`${WCA_ORIGIN}/persons/${person.wca_id}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-semibold text-blue-600 hover:underline"
                  >
                    {person.name}
                  </a>
                  <span className="ml-2 text-xs text-gray-400">{person.wca_id}</span>
                </div>

                {i < result.chain.length - 1 && (
                  <div className="flex flex-col items-center my-2 w-full">
                    <div className="h-3 w-px bg-gray-300" />
                    <div className="text-xs text-gray-500 my-1">competed at</div>
                    <div className="flex flex-col gap-1 w-full items-center">
                      {result.connections[i].map((comp) => (
                        <a
                          key={comp.id}
                          href={`${WCA_ORIGIN}/competitions/${comp.id}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs bg-blue-50 border border-blue-100 text-blue-700 rounded px-3 py-1 hover:bg-blue-100 transition-colors text-center"
                        >
                          {comp.name}
                        </a>
                      ))}
                    </div>
                    <div className="text-xs text-gray-500 my-1">together with</div>
                    <div className="h-3 w-px bg-gray-300" />
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default RelationsPage;
