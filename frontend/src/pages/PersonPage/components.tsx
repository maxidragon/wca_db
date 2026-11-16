import { Link } from "react-router-dom";

export const WCA_ORIGIN = "https://www.worldcubeassociation.org";

export function Card({
  title,
  className = "",
  children,
}: {
  title: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <section className={`rounded-lg border border-gray-200 bg-white ${className}`}>
      <h3 className="border-b border-gray-100 px-4 py-3 font-semibold text-gray-700">
        {title}
      </h3>
      {children}
    </section>
  );
}

export function StatTile({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white px-4 py-3">
      <p className="text-xs uppercase tracking-wide text-gray-500">{label}</p>
      <p className="mt-1 text-xl font-semibold text-gray-900">{value}</p>
      {hint && <p className="mt-0.5 text-xs text-gray-500">{hint}</p>}
    </div>
  );
}

export interface TopListItem {
  key: string;
  label: string;
  hint?: string;
  to?: string;
  count: number;
}

export function TopList({
  title,
  unit,
  items,
}: {
  title: string;
  unit: string;
  items: TopListItem[];
}) {
  return (
    <Card title={title}>
      {items.length === 0 ? (
        <p className="px-4 py-3 text-sm text-gray-500">Nothing to show.</p>
      ) : (
        <ul className="divide-y divide-gray-100">
          {items.map((item) => (
            <li
              key={item.key}
              className="flex items-baseline justify-between gap-3 px-4 py-2 text-sm"
            >
              <span className="min-w-0">
                {item.to ? (
                  <Link to={item.to} className="text-blue-600 hover:underline">
                    {item.label}
                  </Link>
                ) : (
                  <span className="text-gray-800">{item.label}</span>
                )}
                {item.hint && (
                  <span className="block text-xs text-gray-500">{item.hint}</span>
                )}
              </span>
              <span className="shrink-0 whitespace-nowrap text-gray-600">
                {item.count} {unit}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

export function CompetitionLink({ id, name }: { id: string; name: string }) {
  return (
    <a
      href={`${WCA_ORIGIN}/competitions/${id}`}
      target="_blank"
      rel="noopener noreferrer"
      className="text-blue-600 hover:underline"
    >
      {name}
    </a>
  );
}

export function EmptyMessage({ children }: { children: React.ReactNode }) {
  return <p className="px-4 py-3 text-sm text-gray-500">{children}</p>;
}

/** A row of mutually exclusive buttons, styled as the page's tabs. */
export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  label,
  role = "radiogroup",
}: {
  options: readonly { value: T; label: string; count?: number }[];
  value: T;
  onChange: (value: T) => void;
  label: string;
  role?: "radiogroup" | "tablist";
}) {
  const itemRole = role === "tablist" ? "tab" : "radio";
  return (
    <div role={role} aria-label={label} className="flex flex-wrap gap-1 text-sm">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role={itemRole}
          aria-selected={itemRole === "tab" ? option.value === value : undefined}
          aria-checked={itemRole === "radio" ? option.value === value : undefined}
          onClick={() => onChange(option.value)}
          className={`cursor-pointer rounded px-3 py-1.5 font-medium transition-colors ${
            option.value === value
              ? "bg-blue-100 text-blue-700"
              : "text-gray-600 hover:bg-gray-100 hover:text-gray-900"
          }`}
        >
          {option.label}
          {option.count !== undefined && (
            <span className="ml-1.5 text-xs text-gray-500">
              {option.count.toLocaleString()}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}
