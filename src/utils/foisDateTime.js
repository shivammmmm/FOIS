const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function formatFoisDate(value) {
  const parts = parseDateParts(value);
  if (!parts) return String(value ?? "").trim();
  const { year, month, day } = parts;
  return `${String(day).padStart(2, "0")} ${MONTHS[month - 1]} ${year}`;
}

export function formatFoisTime(value) {
  const text = String(value ?? "").trim();
  if (!text) return "";
  let hours;
  let minutes;
  const clock = text.match(/(?:T|\s|^)(\d{1,2}):(\d{2})(?::\d{2})?/);
  if (clock) {
    hours = Number(clock[1]);
    minutes = Number(clock[2]);
  } else if (/^-?\d+(?:\.\d+)?$/.test(text)) {
    const fraction = ((Number(text) % 1) + 1) % 1;
    const totalMinutes = Math.round(fraction * 1440) % 1440;
    hours = Math.floor(totalMinutes / 60);
    minutes = totalMinutes % 60;
  } else {
    return "";
  }
  if (!Number.isFinite(hours) || !Number.isFinite(minutes) || hours > 23 || minutes > 59) return text;
  const suffix = hours >= 12 ? "PM" : "AM";
  const displayHour = hours % 12 || 12;
  return `${String(displayHour).padStart(2, "0")}:${String(minutes).padStart(2, "0")} ${suffix}`;
}

export function formatFoisDateTime(dateValue, timeValue) {
  const date = formatFoisDate(dateValue);
  const embeddedTime = formatFoisTime(dateValue);
  const time = formatFoisTime(timeValue) || (embeddedTime !== String(dateValue ?? "").trim() ? embeddedTime : "");
  if (!date) return time;
  if (!time || date.includes(time)) return date;
  return `${date}, ${time}`;
}

function parseDateParts(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const year = value.getUTCFullYear();
    if (year >= 2000 && year <= 2100) {
      return { year, month: value.getUTCMonth() + 1, day: value.getUTCDate() };
    }
    return null;
  }
  const text = String(value ?? "").trim();
  if (!text) return null;
  if (/^\d+(?:\.\d+)?$/.test(text)) {
    const serial = Number(text);
    // Excel serial numbers for FOIS (2020 - 2030): ~43831 to ~60000
    if (serial >= 40000 && serial <= 60000) {
      const date = new Date(Date.UTC(1899, 11, 30) + Math.floor(serial) * 86400000);
      const year = date.getUTCFullYear();
      if (year >= 2020 && year <= 2100) {
        return { year, month: date.getUTCMonth() + 1, day: date.getUTCDate() };
      }
    }
    return null;
  }
  const iso = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (iso) return validParts(Number(iso[1]), Number(iso[2]), Number(iso[3]));
  const indian = text.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{2,4})/);
  if (indian) {
    const year = indian[3].length === 2 ? 2000 + Number(indian[3]) : Number(indian[3]);
    return validParts(year, Number(indian[2]), Number(indian[1]));
  }
  return null;
}

function validParts(year, month, day) {
  if (year < 2000 || year > 2100 || month < 1 || month > 12 || day < 1 || day > 31) return null;
  return { year, month, day };
}

export function isNumericCode(val) {
  const s = String(val || "").trim();
  if (!s || !/^\d+(\.\d+)?$/.test(s)) return false;
  const num = Number(s);
  if (num >= 40000 && num <= 60000) return false;
  return true;
}
