import React, { useState, useEffect, useMemo } from "react";
import { backendRequest } from "../../utils/request";
import { Editor, useMonaco } from "@monaco-editor/react";
import { getSchema } from "../../utils/utils";
import { VscAdd, VscChromeClose } from "react-icons/vsc";
import toast from "react-hot-toast";
import ActionButtons from "./Components/ActionButtons";
import { logout } from "../../utils/wcaAuth";

interface QueryPageProps {
  token: string | null;
}

interface SavedQuery {
  name: string;
  query: string;
}

const QueryPage: React.FC<QueryPageProps> = ({ token }) => {
  const monaco = useMonaco();
  const [defaultQueryValue, setDefaultQueryValue] = useState<string>("");
  const [query, setQuery] = useState<string>(defaultQueryValue);
  const [results, setResults] = useState<any[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [total, setTotal] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [savedQueries, setSavedQueries] = useState<SavedQuery[]>(
    JSON.parse(localStorage.getItem("localQueries") || "[]")
  );
  const [currentQueryIndex, setCurrentQueryIndex] = useState<number>(-1);
  const [queryNameChangeIndex, setQueryNameChangeIndex] = useState<
    number | null
  >(null);

  const params = useMemo(() => {
    const matches = query.match(/:\w+/g) || [];
    return Array.from(new Set(matches));
  }, [query]);

  const [paramValues, setParamValues] = useState<Record<string, string>>({});
  const [autocompleteEnabled, setAutocompleteEnabled] = useState<boolean>(
    () => {
      const saved = localStorage.getItem("autocompleteEnabled");
      return saved !== null ? saved === "true" : true;
    }
  );

  const toggleAutocomplete = () => {
    setAutocompleteEnabled((prev) => {
      localStorage.setItem("autocompleteEnabled", (!prev).toString());
      return !prev;
    });
  };

  useEffect(() => {
    if (!monaco) return;
    const addSuggestions = async () => {
      const response = await getSchema();
      if (response.status === 200) {
        const schemaData = response.data;

        monaco.languages.registerCompletionItemProvider("sql", {
          triggerCharacters: [" ", ".", ","],
          provideCompletionItems: (model, position) => {
            const textUntilPosition = model.getValueInRange({
              startLineNumber: 1,
              startColumn: 1,
              endLineNumber: position.lineNumber,
              endColumn: position.column,
            });

            const suggestions: any[] = [];
            const keywords = [
              "SELECT",
              "FROM",
              "WHERE",
              "JOIN",
              "LEFT JOIN",
              "RIGHT JOIN",
              "INNER JOIN",
              "GROUP BY",
              "ORDER BY",
              "LIMIT",
              "AS",
              "ON",
              "AND",
              "OR",
              "NOT",
              "DISTINCT",
            ];
            keywords.forEach((kw) =>
              suggestions.push({
                label: kw,
                kind: monaco.languages.CompletionItemKind.Keyword,
                insertText: kw,
              })
            );

            const tableMatches = Array.from(
              textUntilPosition.matchAll(/(?:FROM|JOIN)\s+(\w+)/gi)
            );
            const usedTables = tableMatches.map((m) => m[1]);
            const lastTokens = textUntilPosition.match(/(\w+|\.)+/g) || [];
            const lastToken = lastTokens[lastTokens.length - 1] || "";
            const tableDotMatch = lastToken.match(/^(\w+)\.$/);

            if (tableDotMatch && schemaData[tableDotMatch[1]]) {
              schemaData[tableDotMatch[1]].columns.forEach((col: any) => {
                suggestions.push({
                  label: col.name,
                  kind: monaco.languages.CompletionItemKind.Field,
                  insertText: col.name,
                  detail: col.type,
                });
              });
              return { suggestions };
            }

            const selectContext = /SELECT[\s\S]*$/i.test(textUntilPosition);
            const lastChar = textUntilPosition.slice(-1);
            if (
              selectContext &&
              (lastChar === " " ||
                lastChar === "," ||
                lastToken.toUpperCase() !== "FROM")
            ) {
              usedTables.forEach((t) => {
                if (schemaData[t]) {
                  schemaData[t].columns.forEach((col: any) => {
                    suggestions.push({
                      label: col.name,
                      kind: monaco.languages.CompletionItemKind.Field,
                      insertText: col.name,
                      detail: `${t}.${col.name}`,
                    });
                  });
                }
              });
            }

            if (
              /WHERE\s*$|AND\s*$|ON\s*$|GROUP\s+BY\s*$|ORDER\s+BY\s*$/i.test(
                textUntilPosition
              )
            ) {
              usedTables.forEach((t) => {
                if (schemaData[t]) {
                  schemaData[t].columns.forEach((col: any) => {
                    suggestions.push({
                      label: col.name,
                      kind: monaco.languages.CompletionItemKind.Field,
                      insertText: col.name,
                      detail: `${t}.${col.name}`,
                    });
                  });
                }
              });
            }

            if (/FROM\s*$|JOIN\s*$/i.test(textUntilPosition)) {
              Object.keys(schemaData).forEach((table) => {
                suggestions.push({
                  label: table,
                  kind: monaco.languages.CompletionItemKind.Class,
                  insertText: table,
                  detail: "table",
                });
              });
            }

            if (
              /SELECT\s*$/i.test(textUntilPosition) ||
              lastToken === "," ||
              selectContext
            ) {
              Object.values(schemaData).forEach((table: any) => {
                table.columns.forEach((col: any) => {
                  suggestions.push({
                    label: col.name,
                    kind: monaco.languages.CompletionItemKind.Field,
                    insertText: col.name,
                    detail: `${col.name} (${table.name || "table"})`,
                  });
                });
              });
            }

            return { suggestions };
          },
        });
      } else if (response.status === 401) {
        logout();
      } else {
        toast.error("Error fetching schema");
      }
    };
    addSuggestions();
  }, [monaco]);

  useEffect(() => {
    if (currentQueryIndex >= 0) {
      const queries = [...savedQueries];
      queries[currentQueryIndex].query = query;
      setSavedQueries(queries);
      localStorage.setItem("localQueries", JSON.stringify(queries));
    } else {
      setDefaultQueryValue(query);
    }
  }, [query]);

  const createQuery = () => {
    const newQuery = { name: "New query", query: "" };
    const updated = [...savedQueries, newQuery];
    setSavedQueries(updated);
    setCurrentQueryIndex(updated.length - 1);
    setQuery("");
    localStorage.setItem("localQueries", JSON.stringify(updated));
  };

  const loadQuery = (index: number) => {
    if (index === -1) {
      setQuery(defaultQueryValue);
      setCurrentQueryIndex(-1);
    } else {
      setQuery(savedQueries[index].query);
      setCurrentQueryIndex(index);
    }
  };

  const removeQuery = (id: number) => {
    const queries = [...savedQueries];
    queries.splice(id, 1);
    setSavedQueries(queries);
    localStorage.setItem("localQueries", JSON.stringify(queries));
    if (currentQueryIndex === id) {
      setQuery(defaultQueryValue);
      setCurrentQueryIndex(-1);
    } else if (currentQueryIndex > id) {
      setCurrentQueryIndex(currentQueryIndex - 1);
    }
  };

  const renameEditedQuery = (newName: string) => {
    if (queryNameChangeIndex == null || queryNameChangeIndex === -1) return;
    const queries = [...savedQueries];
    queries[queryNameChangeIndex].name = newName;
    setSavedQueries(queries);
    localStorage.setItem("localQueries", JSON.stringify(queries));
  };

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

  const handleShare = () => {
    const base = window.location.origin + window.location.pathname;
    navigator.clipboard.writeText(`${base}?query=${encodeURIComponent(query)}`);
    toast.success("Query link copied to clipboard");
  };

  const columns = results.length > 0 ? Object.keys(results[0]) : [];

  return (
    <div className="max-w-6xl mx-auto p-4">
      {!token && (
        <p className="mb-3 text-red-500 font-medium">
          You must be logged in to execute any queries.
        </p>
      )}

      <div className="flex gap-2 mb-4 overflow-x-auto">
        <div
          className={`flex line-clamp-1 min-w-max max-h-10 px-4 py-2 bg-gray-400 rounded cursor-pointer ${
            currentQueryIndex === -1 ? "opacity-100" : "opacity-50"
          }`}
          onClick={() => loadQuery(-1)}
        >
          Sandbox
        </div>
        <button
          className="px-4 py-2 bg-green-500 text-white rounded cursor-pointer"
          onClick={createQuery}
        >
          <VscAdd />
        </button>
        {savedQueries.map((q, index) => (
          <div
            key={index}
            className={`flex line-clamp-1 min-w-max max-h-10 px-4 py-2 bg-gray-300 rounded cursor-pointer ${
              currentQueryIndex === index ? "opacity-100" : "opacity-50"
            }`}
          >
            {queryNameChangeIndex === index ? (
              <input
                value={q.name}
                autoFocus
                onChange={(e) => renameEditedQuery(e.target.value)}
                onBlur={() => setQueryNameChangeIndex(null)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") setQueryNameChangeIndex(null);
                }}
                className="px-1 border rounded"
              />
            ) : (
              <span className="cursor-pointer" onClick={() => loadQuery(index)}>
                {q.name}
              </span>
            )}
            <button
              className="ml-2 text-sm text-gray-700"
              onClick={() => setQueryNameChangeIndex(index)}
            >
              ✏️
            </button>
            <button
              className="ml-2 text-sm text-red-500"
              onClick={() => removeQuery(index)}
            >
              <VscChromeClose />
            </button>
          </div>
        ))}
      </div>

      {autocompleteEnabled ? (
        <div className="border border-gray-300 rounded mb-3 shadow-sm">
          <Editor
            height="200px"
            defaultLanguage="sql"
            value={query}
            onChange={(val) => setQuery(val || "")}
            options={{ minimap: { enabled: false }, fontSize: 14 }}
          />
        </div>
      ) : (
        <textarea
          className="w-full p-3 border border-gray-300 rounded mb-3 shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
          rows={4}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Enter query..."
        />
      )}

      <div className="flex items-center mb-3 gap-3">
        <span className="font-medium">Autocomplete</span>
        <button
          type="button"
          onClick={toggleAutocomplete}
          className={`relative inline-flex h-6 w-12 items-center rounded-full transition-colors duration-300 focus:outline-none cursor-pointer ${
            autocompleteEnabled ? "bg-blue-500" : "bg-gray-300"
          }`}
        >
          <span
            className={`inline-block h-5 w-5 transform rounded-full bg-white transition-transform duration-300 ${
              autocompleteEnabled ? "translate-x-6" : "translate-x-1"
            }`}
          />
        </button>
      </div>

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

      <ActionButtons
        token={token}
        isLoading={isLoading}
        page={page}
        pageSize={pageSize}
        total={total}
        setQuery={setQuery}
        setResults={setResults}
        setError={setError}
        setPage={setPage}
        setTotal={setTotal}
        setParamValues={setParamValues}
        handleExecute={handleExecute}
        handleShare={handleShare}
      />

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
                    <td
                      key={col}
                      className="border px-3 py-2 whitespace-pre-wrap"
                    >
                      {row[col] !== null ? row[col].toString() : " "}
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
