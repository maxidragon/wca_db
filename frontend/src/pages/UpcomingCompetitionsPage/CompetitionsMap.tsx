import { useEffect, useMemo } from "react";
import { CircleMarker, MapContainer, Popup, TileLayer, useMap } from "react-leaflet";
import { latLngBounds } from "leaflet";
import "leaflet/dist/leaflet.css";
import { formatDateRange } from "../../utils/results";
import {
  competitorsLabel,
  REGISTRATION_STATUSES,
  registrationDetail,
  statusInfo,
  WCA_ORIGIN,
  type UpcomingCompetition,
} from "./types";

type Located = UpcomingCompetition & { latitude: number; longitude: number };

// Zooms to the competitions shown whenever the filters change which they are.
function FitToCompetitions({ competitions }: { competitions: Located[] }) {
  const map = useMap();
  const key = competitions.map((c) => c.id).join(",");
  useEffect(() => {
    if (competitions.length === 0) return;
    const bounds = latLngBounds(competitions.map((c) => [c.latitude, c.longitude]));
    map.fitBounds(bounds, { padding: [30, 30], maxZoom: 9 });
    // The key stands for the list: a new array with the same competitions keeps the view.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, key]);
  return null;
}

export default function CompetitionsMap({ competitions }: { competitions: UpcomingCompetition[] }) {
  const located = useMemo(
    () =>
      competitions.filter(
        (c): c is Located => c.latitude !== null && c.longitude !== null,
      ),
    [competitions],
  );
  const missing = competitions.length - located.length;

  return (
    <div>
      {/* isolate keeps Leaflet's high z-indexes under the sticky navbar. */}
      <div className="isolate h-[70vh] min-h-96 overflow-hidden rounded-xl border border-gray-200 shadow-sm">
        <MapContainer center={[30, 10]} zoom={2} preferCanvas className="h-full w-full" worldCopyJump>
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          <FitToCompetitions competitions={located} />
          {located.map((competition) => {
            const status = statusInfo(competition.registration_status);
            return (
              <CircleMarker
                key={competition.id}
                center={[competition.latitude, competition.longitude]}
                radius={competition.championships.length > 0 ? 9 : 7}
                pathOptions={{
                  color: competition.championships.length > 0 ? "#111827" : "#ffffff",
                  weight: competition.championships.length > 0 ? 2.5 : 1.5,
                  fillColor: status.color,
                  fillOpacity: 0.9,
                }}
              >
                <Popup>
                  <div className="space-y-1 text-sm">
                    <a
                      href={`${WCA_ORIGIN}/competitions/${competition.id}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-semibold"
                    >
                      {competition.name}
                    </a>
                    <div className="text-gray-600">
                      {formatDateRange(competition.start_date, competition.end_date)} ·{" "}
                      {competition.city}, {competition.country_name}
                    </div>
                    {competition.championships.length > 0 && (
                      <div className="text-gray-600">
                        Championship: {competition.championships.map((c) => c.name).join(", ")}
                      </div>
                    )}
                    <div className="text-gray-600">
                      Competitors: {competitorsLabel(competition)}
                    </div>
                    <div>
                      <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${status.badge}`}>
                        {status.label}
                      </span>{" "}
                      <span className="text-xs text-gray-500">{registrationDetail(competition)}</span>
                    </div>
                  </div>
                </Popup>
              </CircleMarker>
            );
          })}
        </MapContainer>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-600">
        {REGISTRATION_STATUSES.map((status) => (
          <span key={status.id} className="flex items-center gap-1.5">
            <span className="inline-block h-3 w-3 rounded-full border border-white" style={{ background: status.color }} />
            {status.label}
          </span>
        ))}
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-3 w-3 rounded-full border-2 border-gray-900 bg-white" />
          Championship
        </span>
      </div>
      {missing > 0 && (
        <p className="mt-2 text-xs text-gray-500">
          {missing} {missing === 1 ? "competition has" : "competitions have"} no venue location and
          {missing === 1 ? " is" : " are"} only in the list.
        </p>
      )}
    </div>
  );
}
