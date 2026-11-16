import { formatDate } from "../../utils/results";
import { CompetitionLink, EmptyMessage } from "./components";
import type { PersonCompetition, StaffedCompetition } from "./types";

const cell = "px-4 py-2 whitespace-nowrap";

export function CompetitionsTable({
  competitions,
}: {
  competitions: PersonCompetition[];
}) {
  if (competitions.length === 0)
    return <EmptyMessage>This competitor has no results yet.</EmptyMessage>;
  return (
    <>
      <p className="px-4 py-3 text-sm text-gray-500">
        Events and rounds show competed in / total at the competition. PRs count each
        event's single and average beaten at most once per competition.
      </p>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-left text-xs uppercase text-gray-500">
            <tr>
              {[
                ["#", true],
                ["Date", false],
                ["Competition", false],
                ["Venue", false],
                ["City", false],
                ["Competitors", true],
                ["Events", true],
                ["Rounds", true],
                ["Solves", true],
                ["PRs", true],
              ].map(([label, right]) => (
                <th
                  key={String(label)}
                  scope="col"
                  className={`px-4 py-2${right ? " text-right" : ""}`}
                >
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {competitions.map((competition) => (
              <tr key={competition.id} className="hover:bg-gray-50">
                <td className={`${cell} text-right text-gray-500`}>
                  {competition.number}
                </td>
                <td className={`${cell} text-gray-500`}>
                  {formatDate(competition.start_date)}
                </td>
                <td className="px-4 py-2">
                  <CompetitionLink id={competition.id} name={competition.name} />
                </td>
                <td className="px-4 py-2 text-gray-600">{competition.venue}</td>
                <td className={`${cell} text-gray-600`}>
                  {competition.city_name}, {competition.country_name}
                </td>
                <td className={`${cell} text-right text-gray-600`}>
                  {competition.competitors}
                </td>
                <td className={`${cell} text-right text-gray-600`}>
                  {competition.events} / {competition.total_events}
                </td>
                <td className={`${cell} text-right text-gray-600`}>
                  {competition.rounds} / {competition.total_rounds}
                </td>
                <td className={`${cell} text-right text-gray-600`}>
                  {competition.solves} / {competition.attempts}
                </td>
                <td className={`${cell} text-right text-gray-600`}>
                  {competition.personal_records}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

export function StaffedTable({
  competitions,
  emptyMessage,
}: {
  competitions: StaffedCompetition[];
  emptyMessage: string;
}) {
  if (competitions.length === 0) return <EmptyMessage>{emptyMessage}</EmptyMessage>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-gray-50 text-left text-xs uppercase text-gray-500">
          <tr>
            <th scope="col" className="px-4 py-2 text-right">
              #
            </th>
            <th scope="col" className="px-4 py-2">
              Date
            </th>
            <th scope="col" className="px-4 py-2">
              Competition
            </th>
            <th scope="col" className="px-4 py-2">
              City
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {competitions.map((competition) => (
            <tr key={competition.id} className="hover:bg-gray-50">
              <td className={`${cell} text-right text-gray-500`}>
                {competition.number}
              </td>
              <td className={`${cell} text-gray-500`}>
                {formatDate(competition.start_date)}
              </td>
              <td className="px-4 py-2">
                <CompetitionLink id={competition.id} name={competition.name} />
              </td>
              <td className={`${cell} text-gray-600`}>
                {competition.city_name}, {competition.country_name}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
