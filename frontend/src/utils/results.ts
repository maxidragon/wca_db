const pad = (value: number) => String(value).padStart(2, "0");

function formatTime(centiseconds: number): string {
  const hundredths = centiseconds % 100;
  const totalSeconds = Math.floor(centiseconds / 100);
  const seconds = totalSeconds % 60;
  const minutes = Math.floor(totalSeconds / 60) % 60;
  const hours = Math.floor(totalSeconds / 3600);

  if (hours > 0) return `${hours}:${pad(minutes)}:${pad(seconds)}.${pad(hundredths)}`;
  if (minutes > 0) return `${minutes}:${pad(seconds)}.${pad(hundredths)}`;
  return `${seconds}.${pad(hundredths)}`;
}

/** Multi blind, current format: 99 - difference, seconds, missed. */
function formatMultiBlind(value: number): string {
  const difference = 99 - Math.floor(value / 10000000);
  const seconds = Math.floor(value / 100) % 100000;
  const missed = value % 100;
  const solved = difference + missed;
  return `${solved}/${solved + missed} ${formatTime(seconds * 100)}`;
}

/** Multi blind, format used until 2007: 1SSAATTTTT. */
function formatOldMultiBlind(value: number): string {
  const digits = String(value).padStart(10, "0");
  const solved = 99 - Number(digits.slice(1, 3));
  const attempted = 99 - Number(digits.slice(3, 5));
  const seconds = Number(digits.slice(5));
  return `${solved}/${attempted} ${formatTime(seconds * 100)}`;
}

export function formatResult(
  value: number,
  eventId: string,
  type: "single" | "average"
): string {
  if (value === -1) return "DNF";
  if (value === -2) return "DNS";
  if (value <= 0) return "";

  if (eventId === "333fm") {
    return type === "average" ? (value / 100).toFixed(2) : String(value);
  }
  if (eventId === "333mbf") return formatMultiBlind(value);
  if (eventId === "333mbo") return formatOldMultiBlind(value);
  return formatTime(value);
}

export function formatDate(date: string | null): string {
  if (!date) return "";
  return new Date(date).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}
