import React, { useState, useEffect, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { backendRequest } from "../utils/request";

interface QueryPageProps {
  token: string | null;
}

const QueryPage: React.FC<QueryPageProps> = ({ token }) => {
  const [searchParams, setSearchParams] = useSearchParams();
  const [query, setQuery] = useState<string>(searchParams.get("query") || "");
  const [results, setResults] = useState<any[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [total, setTotal] = useState(0);
  const [isLoading, setIsLoading] = useState(false);

  const params = useMemo(() => {
    const matches = query.match(/:\w+/g) || [];
    return Array.from(new Set(matches));
  }, [query]);

  const [paramValues, setParamValues] = useState<Record<string, string>>({});

  useEffect(() => {
    setSearchParams({ query });
  }, [query, setSearchParams]);

  const handleExecute = async (newPage = 1) => {
    if (!query.trim() || !token) return;

    let finalQuery = query;
    params.forEach((p) => {
      const value = paramValues[p] ?? "";
      finalQuery = finalQuery.replace(new RegExp(p, "g"), value);
    });

    try {
      setIsLoading(true);
      const res = await backendRequest("api/query", "POST", true, {
        query: finalQuery,
        page: newPage,
        pageSize,
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Unknown error");
        setResults([]);
      } else {
        setResults(data.rows || []);
        setError(null);
        setPage(newPage);
        setPageSize(data.pageSize || pageSize);
        setTotal(data.total || 0);
      }
    } catch (err: any) {
      setError(err.message);
      setResults([]);
    } finally {
      setIsLoading(false);
    }
  };

  const columns = results.length > 0 ? Object.keys(results[0]) : [];

  return (
    <div className="max-w-6xl mx-auto p-4">
      {!token && (
        <p className="mb-3 text-red-500 font-medium">
          You must be logged in to execute any queries.
        </p>
      )}
      <textarea
        className="w-full p-3 border border-gray-300 rounded mb-3 shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
        rows={4}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Enter query..."
      />

      {params.length > 0 && (
        <div className="mb-3 space-y-2">
          {params.map((p) => (
            <div key={p} className="flex items-center gap-2">
              <label className="w-24 font-medium">{p}</label>
              <input
                type="text"
                value={paramValues[p] || ""}
                onChange={(e) =>
                  setParamValues((prev) => ({ ...prev, [p]: e.target.value }))
                }
                className="flex-1 p-2 border rounded"
                placeholder={`Enter value for ${p}`}
              />
            </div>
          ))}
        </div>
      )}

      <div className="flex gap-2 mb-4">
        <button
          className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 disabled:bg-gray-400 disabled:cursor-not-allowed cursor-pointer"
          onClick={() => handleExecute(1)}
          disabled={!token || isLoading}
        >
          {isLoading ? "Loading..." : "Execute"}
        </button>
        <button
          className="px-4 py-2 bg-gray-200 rounded hover:bg-gray-300 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
          onClick={() => handleExecute(page - 1)}
          disabled={page <= 1 || !token || isLoading}
        >
          Previous
        </button>
        <button
          className="px-4 py-2 bg-gray-200 rounded hover:bg-gray-300 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
          onClick={() => handleExecute(page + 1)}
          disabled={page * pageSize >= total || !token || isLoading}
        >
          Next
        </button>
        <button
          className="px-4 py-2 bg-red-500 text-white rounded hover:bg-red-600 cursor-pointer"
          onClick={() => {
            setQuery("");
            setResults([]);
            setError(null);
            setPage(1);
            setTotal(0);
            setParamValues({});
          }}
          disabled={isLoading}
        >
          Clear
        </button>
      </div>

      {isLoading && (
        <div className="flex justify-center my-4">
          <div className="w-6 h-6 border-4 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
        </div>
      )}

      {error && !isLoading && <p className="text-red-500 mb-3">{error}</p>}
      {!isLoading && results.length > 0 ? (
        <div className="overflow-x-auto border rounded shadow">
          <table className="min-w-full border-collapse">
            <thead className="bg-gray-100">
              <tr>
                {columns.map((col) => (
                  <th key={col} className="border px-3 py-2 text-left">
                    {col}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {results.map((row, idx) => (
                <tr key={idx} className="odd:bg-gray-50">
                  {columns.map((col) => (
                    <td key={col} className="border px-3 py-2">
                      {row[col] !== null ? row[col].toString() : ""}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          <p className="p-2 text-gray-600">
            Page {page} of {Math.ceil(total / pageSize)}, total records: {total}
          </p>
        </div>
      ) : (
        !error &&
        !isLoading && <p className="text-gray-600">No results to display.</p>
      )}
    </div>
  );
};

export default QueryPage;
