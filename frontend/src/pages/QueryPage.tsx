import React, { useState, useEffect, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { backendRequest } from "../utils/request";
import { Editor, useMonaco } from "@monaco-editor/react";
import { getSchema } from "../utils/utils";
import { VscAdd, VscChromeClose } from "react-icons/vsc";
import { useLongPress } from "@uidotdev/usehooks";
import toast from "react-hot-toast";

interface QueryPageProps {
  token: string | null;
}

interface SavedQuery {
  name: string;
  query: string;
}

const QueryPage: React.FC<QueryPageProps> = ({ token }) => {
  const monaco = useMonaco();
  const [searchParams, setSearchParams] = useSearchParams();
  const [query, setQuery] = useState<string>(searchParams.get("query") || "");
  const [results, setResults] = useState<any[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [total, setTotal] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [savedQueries, setSavedQueries] = useState<SavedQuery[]>(JSON.parse(localStorage.getItem("localQueries") || "[]"));
  const [currentQueryIndex, setCurrentQueryIndex] = useState<number | null>(null);
  const [queryNameChangeIndex, setQueryNameChangeIndex] = useState<number | null>(null);

  const longPressHook = useLongPress(
    (event) => {
      const target = event.target as HTMLInputElement;
      if (target == null) return;
      const index = parseInt(target.id)
      setQueryNameChangeIndex(index)
    },
    {
      threshold: 500,
    }
  );

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
    setSearchParams({ query });
  }, [query, setSearchParams]);

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
      } else {
        if (response.status !== 401) {
          toast.error("Error fetching schema");
        }
      }
    };
    addSuggestions();
  }, [monaco]);

  const saveQuery = () => {
    if (currentQueryIndex == null) return;
    let finalQuery = query;
    let queries = savedQueries;
    queries[currentQueryIndex].query = finalQuery
    setSavedQueries([...queries]);
    localStorage.setItem("localQueries", JSON.stringify(queries));
  }

  const createQuery = () => {
    let queries = savedQueries;
    queries.push({name: 'New query', query: ''});
    setCurrentQueryIndex(queries.length - 1);
    setQuery("");
    setSavedQueries([...queries]);
    localStorage.setItem("localQueries", JSON.stringify(queries));
  }

  const loadQuery = (id: number) => {
    let finalQuery = savedQueries[id];
    setQuery(finalQuery.query);
    setCurrentQueryIndex(id);
  }
  
  const removeQuery = (id: number) => {
    let queries = savedQueries;
    queries.splice(id, 1);
    if (currentQueryIndex != null && id < currentQueryIndex){
      setCurrentQueryIndex(currentQueryIndex - 1);
    } else if(currentQueryIndex != null && id == currentQueryIndex){
      setCurrentQueryIndex(null)
      setQuery("");
    }
    setSavedQueries([...queries]);
    localStorage.setItem("localQueries", JSON.stringify(queries));
  }

  const renameEditedQuery = (newName: string) => {
    if (queryNameChangeIndex == null) return;
    let queries = savedQueries;
    queries[queryNameChangeIndex].name = newName;
    setSavedQueries([...queries]);
  }

  function handleKeyDown(event: any){
    if ((event.ctrlKey || event.metaKey) && event.key === "s") {
      event.preventDefault(); 
      saveQuery();
    }
  }

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
      <div className="flex gap-2 mb-4 overflow-x-auto">
        <button
          className="px-4 py-2 bg-green-500 disabled:bg-gray-400 disabled:opacity-50 text-white rounded cursor-pointer"
          onClick={() => {
            createQuery()
          }}>
          <VscAdd className="min-h-6"/>
        </button>
        {savedQueries.map((query, index) => (
          <p
            key={index}
            className={"flex line-clamp-1 min-w-max max-h-10 px-4 py-2 bg-gray-400 rounded cursor-pointer " + (index == currentQueryIndex ? "opacity-100" : "opacity-50")}
            >
              {index == queryNameChangeIndex ? 
                <input
                className="field-sizing-content pr-2"
                value={savedQueries[index].name}
                autoFocus={true}
                onChange={(event) => {renameEditedQuery(event.target.value)}}
                onBlur={() => {setQueryNameChangeIndex(null)}}
                onKeyUp={(event) => {if (event.code == "Enter") setQueryNameChangeIndex(null)}}></input>
              : 
              <span
                className="pr-2"
                {...longPressHook}
                id={index.toString()}
                onClick={() => {
                  if (index == currentQueryIndex) return;
                  loadQuery(index);
                }}
                onDoubleClick={() => {setQueryNameChangeIndex(index)}}>
                  {query.name}
                </span>}
              <span onClick={() => {removeQuery(index)}}><VscChromeClose className="min-h-6"/></span>
            </p>
          ))}
      </div>
      {autocompleteEnabled ? (
        <div className="border border-gray-300 rounded mb-3 shadow-sm" onKeyDown={handleKeyDown}>
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
        <button 
          className="px-4 py-2 bg-green-500 text-white rounded cursor-pointer disabled:bg-gray-300 disabled:opacity-50"
          disabled={currentQueryIndex == null || (currentQueryIndex != null && savedQueries[currentQueryIndex].query == query)}
          onClick={() => {saveQuery()}}>
          Save
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
                    <td key={col} className="border px-3 py-2 whitespace-pre-wrap">
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
