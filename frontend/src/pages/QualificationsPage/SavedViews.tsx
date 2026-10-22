import { useState } from "react";
import { VscChromeClose } from "react-icons/vsc";

const STORAGE_KEY = "savedQualificationViews";

/** What a saved view restores: the requirements and filters, as URL parameters. */
export interface SavedView {
  name: string;
  params: string;
}

function readSaved(): SavedView[] {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
    return Array.isArray(saved) ? saved : [];
  } catch {
    return [];
  }
}

/**
 * Views saved in this browser, the way the Query Tool keeps saved queries: open one, rename it,
 * or remove it. Saving stores what is shown now.
 */
export default function SavedViews({
  current,
  defaultName,
  onOpen,
}: {
  /** The shown view's parameters, or null when there is nothing to save yet. */
  current: string | null;
  defaultName: string;
  onOpen: (params: string) => void;
}) {
  const [views, setViews] = useState<SavedView[]>(readSaved);
  const [renaming, setRenaming] = useState<number | null>(null);

  const store = (next: SavedView[]) => {
    setViews(next);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  };

  const save = () => {
    if (!current) return;
    store([...views, { name: defaultName, params: current }]);
    // A new view starts with a generated name; renaming it right away is the usual next step.
    setRenaming(views.length);
  };

  return (
    <div className="mb-4 flex flex-wrap items-center gap-2 text-sm">
      <span className="font-medium text-gray-700">Saved</span>
      {views.length === 0 && <span className="text-gray-500">No saved views yet.</span>}
      {views.map((view, index) => (
        <div
          key={index}
          className={`flex max-w-xs items-center gap-1 rounded-full border px-3 py-1 ${
            view.params === current
              ? "border-blue-300 bg-blue-50 text-blue-700"
              : "border-gray-300 bg-white text-gray-700"
          }`}
        >
          {renaming === index ? (
            <input
              value={view.name}
              autoFocus
              aria-label="View name"
              onChange={(e) =>
                store(views.map((v, i) => (i === index ? { ...v, name: e.target.value } : v)))
              }
              onBlur={() => setRenaming(null)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === "Escape") setRenaming(null);
              }}
              className="w-48 rounded border border-gray-300 px-1"
            />
          ) : (
            <button
              type="button"
              onClick={() => onOpen(view.params)}
              onDoubleClick={() => setRenaming(index)}
              title={`${view.name} (double-click to rename)`}
              className="cursor-pointer truncate"
            >
              {view.name || "Untitled"}
            </button>
          )}
          <button
            type="button"
            aria-label={`Rename ${view.name}`}
            onClick={() => setRenaming(index)}
            className="cursor-pointer text-gray-400 hover:text-gray-700"
          >
            ✏️
          </button>
          <button
            type="button"
            aria-label={`Remove ${view.name}`}
            onClick={() => {
              store(views.filter((_, i) => i !== index));
              setRenaming(null);
            }}
            className="cursor-pointer text-gray-400 hover:text-red-500"
          >
            <VscChromeClose />
          </button>
        </div>
      ))}
      <button
        type="button"
        disabled={!current || views.some((view) => view.params === current)}
        onClick={save}
        className="cursor-pointer rounded-full border border-gray-300 bg-white px-3 py-1 text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40"
      >
        + Save current view
      </button>
    </div>
  );
}
