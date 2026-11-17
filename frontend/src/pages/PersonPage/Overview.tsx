import { formatResult } from "../../utils/results";
import { Card, EmptyMessage, TopList } from "./components";
import type { PersonalBestResult, PersonProfile } from "./types";

function rankCells(ranks: PersonalBestResult | null) {
  return (["world_rank", "continent_rank", "country_rank"] as const).map((key) => (
    <td key={key} className="px-3 py-2 text-right text-gray-500">
      {ranks ? ranks[key] : ""}
    </td>
  ));
}

function PersonalBests({ profile }: { profile: PersonProfile }) {
  return (
    <Card title="Personal bests">
      {profile.personal_bests.length === 0 ? (
        <EmptyMessage>This competitor has no personal bests yet.</EmptyMessage>
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
                {(["single", "average"] as const).flatMap((kind) =>
                  ["Result", "World", "Continent", "Country"].map((label) => (
                    <th
                      scope="col"
                      key={`${kind}-${label}`}
                      className="px-3 py-2 text-right font-normal"
                    >
                      {label}
                    </th>
                  )),
                )}
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
  );
}

function CompetitionsPerYear({ years }: { years: PersonProfile["years"] }) {
  const most = Math.max(1, ...years.map((year) => year.competitions));
  return (
    <Card title="Competitions per year">
      {years.length === 0 ? (
        <EmptyMessage>Nothing to show.</EmptyMessage>
      ) : (
        <ul className="divide-y divide-gray-100">
          {years.map((year) => (
            <li key={year.year} className="flex items-center gap-3 px-4 py-2 text-sm">
              <span className="w-12 shrink-0 text-gray-700">{year.year}</span>
              <span className="h-2 flex-1 rounded bg-gray-100">
                <span
                  className="block h-2 rounded bg-blue-500"
                  style={{ width: `${(year.competitions / most) * 100}%` }}
                />
              </span>
              <span className="w-8 shrink-0 text-right text-gray-600">
                {year.competitions}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

/** Personal bests, then the people and places the competitor's competitions add up to. */
export default function Overview({ profile }: { profile: PersonProfile }) {
  return (
    <div className="space-y-6">
      <PersonalBests profile={profile} />

      <div className="grid items-start gap-4 lg:grid-cols-2">
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
        <CompetitionsPerYear years={profile.years} />
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
    </div>
  );
}
