import { isIP } from 'node:net';

// RFC 3339 section 5.6: numeric offsets are local time minus UTC.
const DATE = /^(\d{4})-(\d{2})-(\d{2})$/u;
const TIME = /^(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?([Zz]|([+-])(\d{2}):(\d{2}))$/u;
const MONTH_DAYS = Object.freeze([31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]);

function monthLength(year, month) {
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  return month === 2 && leap ? 29 : MONTH_DAYS[month - 1];
}

function fullMatch(expression, value) {
  if (typeof value !== 'string') return null;
  const match = expression.exec(value);
  return match?.[0] === value ? match : null;
}

function parseDate(value) {
  const match = fullMatch(DATE, value);
  if (match === null) return null;
  const [, yearText, monthText, dayText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  if (month < 1 || month > 12 || day < 1 || day > monthLength(year, month)) return null;
  return { year, month, day };
}

function parseTime(value) {
  const match = fullMatch(TIME, value);
  if (match === null) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  const second = Number(match[3]);
  const offsetHour = Number(match[6] ?? 0);
  const offsetMinute = Number(match[7] ?? 0);
  if (hour > 23 || minute > 59 || second > 60 || offsetHour > 23 || offsetMinute > 59) return null;
  const offset = (match[5] === '-' ? -1 : 1) * (offsetHour * 60 + offsetMinute);
  const utcMinutes = hour * 60 + minute - offset;
  const minuteOfDay = ((utcMinutes % 1440) + 1440) % 1440;
  // A full-time has no date. Check possible leap-second placement, not an
  // historical leap-second schedule. The date-time check adds the UTC date.
  if (second === 60 && minuteOfDay !== 1439) return null;
  return { second, utcMinutes };
}

function dateTime(value) {
  if (typeof value !== 'string' || !['T', 't'].includes(value[10])) return false;
  const date = parseDate(value.slice(0, 10));
  const time = parseTime(value.slice(11));
  if (date === null || time === null) return false;
  if (time.second !== 60) return true;
  // Offsets are less than one day. Day zero is the previous month's final
  // day; otherwise the UTC day must equal the current month's final day.
  // This permits a leap second at any month end without asserting that one
  // was announced. No wall clock, Date.parse normalization or network state.
  const utcDay = date.day + Math.floor(time.utcMinutes / 1440);
  return utcDay === 0 || utcDay === monthLength(date.year, date.month);
}

const assertion = (test) => Object.freeze({ test });
const regex = (expression) => assertion((value) => fullMatch(expression, value) !== null);

// A format name is untrusted schema data. Inherited Object members must never
// be mistaken for validators; unknown names retain their annotation behavior.
export const FORMAT_ASSERTIONS = Object.freeze(Object.assign(Object.create(null), {
  'date': assertion((value) => parseDate(value) !== null),
  'date-time': assertion(dateTime),
  'duration': regex(/^P(?!$)(\d+Y)?(\d+M)?(\d+W)?(\d+D)?(T(?=\d)(\d+H)?(\d+M)?(\d+(\.\d+)?S)?)?$/u),
  'email': regex(/^[^@\s]+@[^@\s.]+(\.[^@\s.]+)+$/u),
  'hostname': regex(/^[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*$/u),
  'ipv4': assertion((value) => typeof value === 'string' && isIP(value) === 4),
  'ipv6': assertion((value) => typeof value === 'string' && !value.includes('%') && isIP(value) === 6),
  'time': assertion((value) => parseTime(value) !== null),
  'uri': regex(/^[A-Za-z][A-Za-z0-9+.-]*:\S*$/u),
  'uri-reference': regex(/^\S*$/u),
  'uuid': regex(/^[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}$/u),
}));
