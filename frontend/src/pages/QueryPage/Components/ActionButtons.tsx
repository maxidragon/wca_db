import { BiTrash, BiShareAlt } from "react-icons/bi";

interface ActionButtonsProps {
  token: string | null;
  isLoading: boolean;
  page: number;
  pageSize: number;
  total: number;
  setQuery: (query: string) => void;
  setResults: (results: any[]) => void;
  setError: (error: string | null) => void;
  setPage: (page: number) => void;
  setTotal: (total: number) => void;
  setParamValues: (params: Record<string, any>) => void;
  handleExecute: (page: number) => void;
  handleShare: () => void;
}

const ActionButtons = (
    {
        token,
        isLoading,
        page,
        pageSize,
        total,
        setQuery,
        setResults,
        setError,
        setPage,
        setTotal,
        setParamValues,
        handleExecute,
        handleShare,
    }: ActionButtonsProps,
) => {
  return (
    <div className="flex md:flex-row flex-col gap-2 mb-4">
      <button
        className="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700 disabled:bg-gray-400 disabled:cursor-not-allowed cursor-pointer"
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
        className="px-4 py-2 bg-red-500 text-white rounded hover:bg-red-600 cursor-pointer flex items-center justify-center gap-1"
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
        <BiTrash />
        Clear
      </button>
      <button
        className="px-4 py-2 bg-blue-500 text-white rounded cursor-pointer flex items-center justify-center gap-1 hover:bg-blue-600"
        onClick={handleShare}
      >
        <BiShareAlt />
        Share
      </button>
    </div>
  );
};

export default ActionButtons;
