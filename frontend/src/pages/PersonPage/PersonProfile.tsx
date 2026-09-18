import { Link } from "react-router-dom";
import { formatDate, formatResult } from "../../utils/results";
import type { PersonalBestResult, PersonProfile } from "./types";

const WCA_ORIGIN = "https://www.worldcubeassociation.org";

interface TopListItem {
  key: string;
  label: string;
  hint?: string;
  to?: string;
  count: number;
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-gray-200 bg-white">
      <h3 className="border-b border-gray-100 px-4 py-3 font-semibold text-gray-700">
        {title}
      </h3>
      {children}
    </section>
  );
}

function StatTile({
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

function TopList({
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

function rankCells(ranks: PersonalBestResult | null) {
  return (["world_rank", "continent_rank", "country_rank"] as const).map((key) => (
    <td key={key} className="px-3 py-2 text-right text-gray-500">
      {ranks ? ranks[key] : ""}
    </td>
  ));
}

export default function PersonProfileView({ profile }: { profile: PersonProfile }) {
  const { person, totals } = profile;
  const mostCompetitionsInAYear = Math.max(
    1,
    ...profile.years.map((year) => year.competitions),
  );

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-gray-900">
          <a
            href={`${WCA_ORIGIN}/persons/${person.wca_id}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-600 hover:underline"
          >
            {person.name}
          </a>
        </h2>
        <p className="text-sm text-gray-500">
          {person.wca_id} · {person.country_name} · {person.continent_name}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <StatTile
          label="Competitions"
          value={String(totals.competitions)}
          hint={
            totals.first_competition_date
              ? `since ${formatDate(totals.first_competition_date)}`
              : undefined
          }
        />
        <StatTile
          label="Countries"
          value={String(totals.countries)}
          hint="competed in"
        />
        <StatTile label="Events" value={String(totals.events)} hint="competed in" />
        <StatTile
          label="Solves"
          value={String(totals.solves)}
          hint={`${totals.attempts - totals.solves} DNF/DNS of ${totals.attempts} attempts`}
        />
        <StatTile
          label="Medals"
          value={`${totals.gold} / ${totals.silver} / ${totals.bronze}`}
          hint="gold / silver / bronze"
        />
      </div>

      {totals.world_records + totals.continental_records + totals.national_records >
        0 && (
        <div className="grid grid-cols-3 gap-3">
          <StatTile label="World records" value={String(totals.world_records)} />
          <StatTile
            label="Continental records"
            value={String(totals.continental_records)}
          />
          <StatTile label="National records" value={String(totals.national_records)} />
        </div>
      )}

      <Card title="Personal bests">
        {profile.personal_bests.length === 0 ? (
          <p className="px-4 py-3 text-sm text-gray-500">
            This competitor has no personal bests yet.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-xs uppercase text-gray-500">
                <tr>
                  <th scope="col" rowSpan={2} className="px-4 py-2 text-left">
                    Event
                  </th>
                  <th scope="colgroup" colSpan={4} className="px-3 py-2 text-center">
                    Single
                  </th>
                  <th scope="colgroup" colSpan={4} className="px-3 py-2 text-center">
                    Average
                  </th>
                </tr>
                <tr>
                  {["Result", "World", "Continent", "Country"].map((label) => (
                    <th
                      scope="col"
                      key={`single-${label}`}
                      className="px-3 py-2 text-right font-normal"
                    >
                      {label}
                    </th>
                  ))}
                  {["Result", "World", "Continent", "Country"].map((label) => (
                    <th
                      scope="col"
                      key={`average-${label}`}
                      className="px-3 py-2 text-right font-normal"
                    >
                      {label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {profile.personal_bests.map((best) => (
                  <tr key={best.event_id} className="hover:bg-gray-50">
                    <td className="px-4 py-2 whitespace-nowrap text-gray-700">
                      {best.event_name}
                    </td>
                    <td className="px-3 py-2 text-right font-semibold whitespace-nowrap">
                      {best.single
                        ? formatResult(best.single.result, best.event_id, "single")
                        : ""}
                    </td>
                    {rankCells(best.single)}
                    <td className="px-3 py-2 text-right font-semibold whitespace-nowrap">
                      {best.average
                        ? formatResult(best.average.result, best.event_id, "average")
                        : ""}
                    </td>
                    {rankCells(best.average)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <TopList
          title="Most competitions together"
          unit="together"
          items={profile.competitors.map((competitor) => ({
            key: competitor.wca_id,
            label: competitor.name,
            hint: competitor.wca_id,
            to: `/person?wca_id=${competitor.wca_id}`,
            count: competitor.competitions,
          }))}
        />
        <TopList
          title="Most visited venues"
          unit="competitions"
          items={profile.venues.map((venue) => ({
            key: `${venue.venue}-${venue.city_name}`,
            label: venue.venue,
            hint: `${venue.city_name}, ${venue.country_name}`,
            count: venue.competitions,
          }))}
        />
        <TopList
          title="Most visited cities"
          unit="competitions"
          items={profile.cities.map((city) => ({
            key: `${city.city_name}-${city.country_name}`,
            label: city.city_name,
            hint: city.country_name,
            count: city.competitions,
          }))}
        />
        <TopList
          title="Countries competed in"
          unit="competitions"
          items={profile.countries.map((country) => ({
            key: country.country_id,
            label: country.country_name,
            count: country.competitions,
          }))}
        />
      </div>

      <Card title="Competitions per year">
        <ul className="divide-y divide-gray-100">
          {profile.years.map((year) => (
            <li key={year.year} className="flex items-center gap-3 px-4 py-2 text-sm">
              <span className="w-12 shrink-0 text-gray-700">{year.year}</span>
              <span className="h-2 flex-1 rounded bg-gray-100">
                <span
                  className="block h-2 rounded bg-blue-500"
                  style={{
                    width: `${(year.competitions / mostCompetitionsInAYear) * 100}%`,
                  }}
                />
              </span>
              <span className="w-8 shrink-0 text-right text-gray-600">
                {year.competitions}
              </span>
            </li>
          ))}
        </ul>
      </Card>

      <Card title={`All competitions (${profile.competitions.length})`}>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-left text-xs uppercase text-gray-500">
              <tr>
                <th scope="col" className="px-4 py-2">
                  Date
                </th>
                <th scope="col" className="px-4 py-2">
                  Competition
                </th>
                <th scope="col" className="px-4 py-2">
                  Venue
                </th>
                <th scope="col" className="px-4 py-2">
                  City
                </th>
                <th scope="col" className="px-4 py-2 text-right">
                  Events
                </th>
                <th scope="col" className="px-4 py-2 text-right">
                  Solves
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {profile.competitions.map((competition) => (
                <tr key={competition.id} className="hover:bg-gray-50">
                  <td className="px-4 py-2 whitespace-nowrap text-gray-500">
                    {formatDate(competition.start_date)}
                  </td>
                  <td className="px-4 py-2">
                    <a
                      href={`${WCA_ORIGIN}/competitions/${competition.id}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-blue-600 hover:underline"
                    >
                      {competition.name}
                    </a>
                  </td>
                  <td className="px-4 py-2 text-gray-600">{competition.venue}</td>
                  <td className="px-4 py-2 whitespace-nowrap text-gray-600">
                    {competition.city_name}, {competition.country_name}
                  </td>
                  <td className="px-4 py-2 text-right text-gray-600">
                    {competition.events}
                  </td>
                  <td className="px-4 py-2 text-right whitespace-nowrap text-gray-600">
                    {competition.solves} / {competition.attempts}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
