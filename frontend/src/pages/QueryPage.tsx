import React, { useState, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { backendRequest } from "../utils/wcaAuth";

interface QueryPageProps {
  token: string | null;
}

const QueryPage: React.FC<QueryPageProps> = ({ token }) => {
  const [searchParams, setSearchParams] = useSearchParams();
  const [query, setQuery] = useState<string>(searchParams.get("query") || "");
  const [results, setResults] = useState<any[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const pageSize = 20;
  const [total, setTotal] = useState(0);

  useEffect(() => {
    setSearchParams({ query });
  }, [query, setSearchParams]);

  const handleExecute = async (newPage = 1) => {
    if (!query.trim() || !token) return;

    try {
      const res = await backendRequest("api/query", "POST", true, {
        query,
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
        setTotal(data.total || 0);
      }
    } catch (err: any) {
      setError(err.message);
      setResults([]);
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
        placeholder="Enter SELECT or DESC query..."
      />
      <div className="flex gap-2 mb-4">
        <button
          className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 disabled:bg-gray-400"
          onClick={() => handleExecute(1)}
          disabled={!token}
        >
          Execute
        </button>
        <button
          className="px-4 py-2 bg-gray-200 rounded hover:bg-gray-300 disabled:opacity-50"
          onClick={() => handleExecute(page - 1)}
          disabled={page <= 1 || !token}
        >
          Previous
        </button>
        <button
          className="px-4 py-2 bg-gray-200 rounded hover:bg-gray-300 disabled:opacity-50"
          onClick={() => handleExecute(page + 1)}
          disabled={page * pageSize >= total || !token}
        >
          Next
        </button>
      </div>
      {error && <p className="text-red-500 mb-3">{error}</p>}
      {results.length > 0 && (
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
      )}
    </div>
  );
};

export default QueryPage;
