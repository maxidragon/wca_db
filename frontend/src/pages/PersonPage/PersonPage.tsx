import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { backendRequest } from "../../utils/request";
import PersonProfileView from "./PersonProfile";
import type { PersonProfile } from "./types";

const WCA_ID_RE = /^\d{4}[A-Z]{4}\d{2}$/;
const INVALID_ID_MESSAGE = "Invalid WCA ID format (expected e.g. 2009ZEMD01)";

const PersonPage = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedId = (searchParams.get("wca_id") || "").trim().toUpperCase();
  const [wcaId, setWcaId] = useState(requestedId);
  const [profile, setProfile] = useState<PersonProfile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  // The profile follows the URL rather than the submit button, so a shared link and the
  // links between competitors both load the competitor they name.
  useEffect(() => {
    setWcaId(requestedId);
    setProfile(null);
    if (!requestedId) {
      setError(null);
      return;
    }
    if (!WCA_ID_RE.test(requestedId)) {
      setError(INVALID_ID_MESSAGE);
      return;
    }

    const request = new AbortController();
    setError(null);
    setIsLoading(true);
    (async () => {
      try {
        const res = await backendRequest(
          `api/person?wca_id=${requestedId}`,
          "GET",
          true,
          undefined,
          request.signal,
        );
        const data = await res.json();
        if (res.ok) setProfile(data);
        else setError(data.error || "Unknown error");
      } catch (err) {
        if (!request.signal.aborted)
          setError(err instanceof Error ? err.message : "Could not load the profile");
      } finally {
        if (!request.signal.aborted) setIsLoading(false);
      }
    })();
    return () => request.abort();
  }, [requestedId]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const id = wcaId.trim().toUpperCase();
    if (!WCA_ID_RE.test(id)) {
      setError(INVALID_ID_MESSAGE);
      return;
    }
    setSearchParams({ wca_id: id });
  };

  return (
    <div className="mx-auto max-w-6xl p-4">
      <h2 className="mb-1 text-2xl font-bold">Person</h2>
      <p className="mb-6 text-sm text-gray-500">
        Everything one competitor's results say about them: personal bests, every
        competition, who they have competed with most, and where they have competed.
      </p>

      <form onSubmit={handleSubmit} className="mb-8 flex flex-col gap-3 sm:flex-row">
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

      {isLoading && (
        <div className="my-8 flex justify-center">
          <div className="h-6 w-6 animate-spin rounded-full border-4 border-blue-500 border-t-transparent" />
        </div>
      )}

      {error && !isLoading && <p className="text-red-500">{error}</p>}

      {profile && !isLoading && <PersonProfileView profile={profile} />}
    </div>
  );
};

export default PersonPage;
