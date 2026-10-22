import { useEffect, useRef, useState } from "react";
import { backendRequest } from "../../utils/request";
import { formatDate } from "../../utils/results";
import type { Competition } from "./requirements";

/**
 * Searches competitions that have qualification requirements. Shows the selected competition's
 * name once it has loaded, and only searches again when the user types something else.
 */
export default function CompetitionSearch({
  initialQuery,
  selectedName,
  disabled,
  onSelect,
}: {
  initialQuery: string;
  selectedName: string | null;
  disabled: boolean;
  onSelect: (competitionId: string) => void;
}) {
  const [query, setQuery] = useState(initialQuery);
  const [suggestions, setSuggestions] = useState<Competition[]>([]);
  const [searchOpen, setSearchOpen] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const searchVersion = useRef(0);

  useEffect(() => {
    if (selectedName) setQuery(selectedName);
  }, [selectedName]);

  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < 2 || selectedName === query) {
      setSuggestions([]);
      setIsSearching(false);
      return;
    }
    const version = ++searchVersion.current;
    const timer = window.setTimeout(async () => {
      setIsSearching(true);
      try {
        const response = await backendRequest(
          `api/competitions/search?q=${encodeURIComponent(trimmed)}&with_qualifications=1`,
          "GET",
          true,
        );
        const data = await response.json();
        if (version === searchVersion.current) {
          setSuggestions(response.ok ? data.competitions : []);
          setSearchOpen(true);
        }
      } catch {
        if (version === searchVersion.current) setSuggestions([]);
      } finally {
        if (version === searchVersion.current) setIsSearching(false);
      }
    }, 250);
    return () => window.clearTimeout(timer);
  }, [query, selectedName]);

  const select = (id: string) => {
    setSuggestions([]);
    setSearchOpen(false);
    onSelect(id);
  };

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const trimmed = query.trim();
    const exact = suggestions.find(
      (competition) => competition.id.toLowerCase() === trimmed.toLowerCase(),
    );
    if (exact) select(exact.id);
    else if (/^[a-z0-9_-]*\d{4}$/i.test(trimmed)) select(trimmed);
    else if (suggestions.length === 1) select(suggestions[0].id);
    else setSearchOpen(true);
  };

  return (
    <form onSubmit={submit} className="relative mb-6 max-w-2xl">
      <div className="flex gap-2">
        <div className="relative flex-1">
          <input
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setSearchOpen(true);
            }}
            onFocus={() => setSearchOpen(true)}
            placeholder="Search competitions with qualification requirements"
            className="w-full rounded-lg border border-gray-300 bg-white px-4 py-2.5 pr-10 focus:outline-none focus:ring-2 focus:ring-blue-400"
          />
          {isSearching && (
            <div className="absolute right-3 top-3 h-5 w-5 animate-spin rounded-full border-2 border-blue-500 border-t-transparent" />
          )}
        </div>
        <button
          type="submit"
          disabled={disabled || query.trim().length < 2}
          className="cursor-pointer rounded-lg bg-blue-500 px-5 py-2.5 text-white hover:bg-blue-600 disabled:cursor-not-allowed disabled:bg-gray-400"
        >
          Search
        </button>
      </div>

      {searchOpen && suggestions.length > 0 && (
        <div className="absolute z-20 mt-1 max-h-80 w-[calc(100%-6.5rem)] overflow-y-auto rounded-lg border border-gray-200 bg-white shadow-lg">
          {suggestions.map((competition) => (
            <button
              key={competition.id}
              type="button"
              onClick={() => select(competition.id)}
              className="flex w-full cursor-pointer items-center justify-between gap-4 border-b border-gray-100 px-4 py-3 text-left last:border-0 hover:bg-blue-50"
            >
              <span>
                <span className="block text-sm font-medium text-gray-800">{competition.name}</span>
                <span className="block text-xs text-gray-400">{competition.id}</span>
              </span>
              <span className="shrink-0 text-xs text-gray-500">
                {formatDate(competition.start_date)}
              </span>
            </button>
          ))}
        </div>
      )}
    </form>
  );
}
