import { useEffect, useMemo, useState } from "react";
import { VscLock, VscUnlock } from "react-icons/vsc";
import { Circle, CircleMarker, MapContainer, Marker, Popup, TileLayer, useMap, useMapEvents } from "react-leaflet";
import { divIcon, latLngBounds, type DivIcon } from "leaflet";
import "leaflet/dist/leaflet.css";
import { formatDateRange } from "../../utils/results";
import {
  competitorsLabel,
  MY_REGISTRATION_LABELS,
  REGISTERED_COLOR,
  REGISTRATION_STATUSES,
  registrationDetail,
  statusInfo,
  WCA_ORIGIN,
  type UpcomingCompetition,
} from "./types";

type Located = UpcomingCompetition & { latitude: number; longitude: number };

// The pin in a 24 x 32 box: a round head centred on (12, 12) and the tip at (12, 31.5).
const PIN_PATH = "M12 31.5C12 31.5 1 20 1 12a11 11 0 0 1 22 0c0 8-11 19.5-11 19.5z";
const PIN_TIP = { x: 12, y: 31.5 };
const CHAMPIONSHIP_STROKE = "#111827";

type PinStyle = { color: string; championship: boolean; registered: boolean };

// Pixels per unit of the pin's box: a championship pin is drawn larger.
const pinScale = (championship: boolean) => (championship ? 1 : 0.8);

// The pin as SVG markup, shared by the map icons and the legend. A registered competition gets a
// blue halo around the whole pin, so the box grows by the halo's width on every side.
function pinSvg({ color, championship, registered }: PinStyle, scale = pinScale(championship)): string {
  const pad = registered ? 3.5 : 1.5;
  const width = (24 + 2 * pad) * scale;
  const height = (32 + 2 * pad) * scale;
  const stroke = championship ? CHAMPIONSHIP_STROKE : "#ffffff";
  const strokeWidth = championship ? 2.5 : 1.5;
  const halo = registered
    ? `<path d="${PIN_PATH}" fill="none" stroke="${REGISTERED_COLOR}" stroke-width="7" stroke-linejoin="round"/>`
    : "";
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" ` +
    `viewBox="${-pad} ${-pad} ${24 + 2 * pad} ${32 + 2 * pad}" style="display:block;overflow:visible">` +
    halo +
    `<path d="${PIN_PATH}" fill="${color}" stroke="${stroke}" stroke-width="${strokeWidth}" stroke-linejoin="round"/>` +
    `<circle cx="12" cy="12" r="4" fill="#ffffff"/>` +
    `</svg>`
  );
}

const pinIcons = new Map<string, DivIcon>();

// One icon per look, reused by every competition that shares it.
function pinIcon(style: PinStyle): DivIcon {
  const key = `${style.color}|${style.championship}|${style.registered}`;
  let icon = pinIcons.get(key);
  if (!icon) {
    const scale = pinScale(style.championship);
    const pad = style.registered ? 3.5 : 1.5;
    const width = (24 + 2 * pad) * scale;
    const height = (32 + 2 * pad) * scale;
    const tip: [number, number] = [(PIN_TIP.x + pad) * scale, (PIN_TIP.y + pad) * scale];
    icon = divIcon({
      html: pinSvg(style, scale),
      // Without a class name Leaflet draws its default white box behind the icon.
      className: "competition-pin",
      iconSize: [width, height],
      iconAnchor: tip,
      // The popup opens just above the pin's head.
      popupAnchor: [0, -tip[1] + 2],
    });
    pinIcons.set(key, icon);
  }
  return icon;
}

function LegendPin(style: PinStyle) {
  // Static markup built from constants, never from user input.
  return <span aria-hidden className="inline-block" dangerouslySetInnerHTML={{ __html: pinSvg(style, 0.5) }} />;
}

const LOCK_STORAGE_KEY = "upcomingCompetitionsPointLocked";

function readLocked(): boolean {
  try {
    return localStorage.getItem(LOCK_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

// Kept in this browser rather than the URL: it is how someone uses the map, not what it shows.
function storeLocked(locked: boolean) {
  try {
    if (locked) localStorage.setItem(LOCK_STORAGE_KEY, "1");
    else localStorage.removeItem(LOCK_STORAGE_KEY);
  } catch {
    // Storage can be unavailable (private mode, quota); the lock then lasts until the page closes.
  }
}

// Zooms to the competitions shown whenever the filters change which they are.
function FitToCompetitions({ competitions }: { competitions: Located[] }) {
  const map = useMap();
  // Sorted, so re-sorting the same competitions by distance keeps the view.
  const key = competitions.map((c) => c.id).sort().join(",");
  useEffect(() => {
    if (competitions.length === 0) return;
    const bounds = latLngBounds(competitions.map((c) => [c.latitude, c.longitude]));
    map.fitBounds(bounds, { padding: [30, 30], maxZoom: 9 });
    // The key stands for the list: a new array with the same competitions keeps the view.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, key]);
  return null;
}

// A click on the map, not on a marker, picks the point distances are measured from.
function PickOnClick({ onPick }: { onPick: (latitude: number, longitude: number) => void }) {
  useMapEvents({
    click(event) {
      const { lat, lng } = event.latlng.wrap();
      onPick(lat, lng);
    },
  });
  return null;
}

export default function CompetitionsMap({
  competitions,
  near,
  radiusKm,
  onPick,
}: {
  competitions: UpcomingCompetition[];
  near: string | null;
  radiusKm: number | null;
  onPick: (latitude: number, longitude: number) => void;
}) {
  const centre = near ? (near.split(",").map(Number) as [number, number]) : null;
  const located = useMemo(
    () =>
      competitions.filter(
        (c): c is Located => c.latitude !== null && c.longitude !== null,
      ),
    [competitions],
  );
  const missing = competitions.length - located.length;
  const [locked, setLocked] = useState(readLocked);
  const toggleLocked = () => {
    storeLocked(!locked);
    setLocked(!locked);
  };
  // The lock only keeps a point that is there: without one, a click still picks the first.
  const pointLocked = locked && centre !== null;

  return (
    <div>
      {/* isolate keeps Leaflet's high z-indexes under the sticky navbar. */}
      <div className="relative isolate h-[70vh] min-h-96 overflow-hidden rounded-xl border border-gray-200 shadow-sm">
        {/* Outside the map container, so clicking it never reaches the map as a pick. */}
        {centre && (
          <button
            type="button"
            aria-pressed={locked}
            onClick={toggleLocked}
            title={locked ? "Let a click on the map move the point" : "Keep the point when the map is clicked"}
            className={`absolute top-2.5 right-2.5 z-[1000] flex cursor-pointer items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium shadow-sm ${
              locked
                ? "border-red-300 bg-red-50 text-red-700 hover:bg-red-100"
                : "border-gray-300 bg-white text-gray-700 hover:bg-gray-50"
            }`}
          >
            {locked ? <VscLock aria-hidden /> : <VscUnlock aria-hidden />}
            {locked ? "Point locked" : "Lock point"}
          </button>
        )}
        <MapContainer center={[30, 10]} zoom={2} preferCanvas className="h-full w-full" worldCopyJump>
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          <FitToCompetitions competitions={located} />
          {!pointLocked && <PickOnClick onPick={onPick} />}
          {centre && radiusKm && (
            <Circle
              center={centre}
              radius={radiusKm * 1000}
              interactive={false}
              pathOptions={{ color: "#2563eb", weight: 1.5, fillOpacity: 0.06, dashArray: "6 6" }}
            />
          )}
          {centre && (
            <CircleMarker
              center={centre}
              radius={5}
              interactive={false}
              pathOptions={{ color: "#ffffff", weight: 2, fillColor: "#dc2626", fillOpacity: 1 }}
            />
          )}
          {located.map((competition) => {
            const status = statusInfo(competition.registration_status);
            const championship = competition.championships.length > 0;
            return (
              <Marker
                key={competition.id}
                position={[competition.latitude, competition.longitude]}
                icon={pinIcon({
                  color: status.color,
                  championship,
                  registered: competition.my_registration !== null,
                })}
                // Championships and the viewer's own competitions stay on top of their neighbours.
                zIndexOffset={(championship ? 1000 : 0) + (competition.my_registration ? 2000 : 0)}
                bubblingMouseEvents={false}
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
                    {competition.my_registration && (
                      <div className="font-medium text-blue-700">
                        {MY_REGISTRATION_LABELS[competition.my_registration]}
                      </div>
                    )}
                    {competition.distance_km !== null && (
                      <div className="text-gray-600">
                        Distance: {competition.distance_km.toLocaleString()} km
                      </div>
                    )}
                    <div>
                      <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${status.badge}`}>
                        {status.label}
                      </span>{" "}
                      <span className="text-xs text-gray-500">{registrationDetail(competition)}</span>
                    </div>
                  </div>
                </Popup>
              </Marker>
            );
          })}
        </MapContainer>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-600">
        {REGISTRATION_STATUSES.map((status) => (
          <span key={status.id} className="flex items-center gap-1.5">
            <LegendPin color={status.color} championship={false} registered={false} />
            {status.label}
          </span>
        ))}
        <span className="flex items-center gap-1.5">
          <LegendPin color="#ffffff" championship registered={false} />
          Championship
        </span>
        <span className="flex items-center gap-1.5">
          <LegendPin color="#ffffff" championship={false} registered />
          Registered
        </span>
        <span className="text-gray-500">
          {pointLocked
            ? "The point is locked: unlock it to pick another by clicking the map."
            : "Click the map to measure distances from that point."}
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
