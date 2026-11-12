// Date helpers: relative times ("3 hours ago"), full dates for tooltips, and short SLA durations.
import dayjs from 'dayjs';
import en from 'dayjs/locale/en';
import localizedFormat from 'dayjs/plugin/localizedFormat';
import relativeTime from 'dayjs/plugin/relativeTime';

dayjs.extend(relativeTime);
dayjs.extend(localizedFormat);

// A compact copy of the English wording for SLA badges ("2h", "25m", "3d"). Registered without
// becoming the default, so other relative dates still read "3 hours ago".
const SHORT_LOCALE = 'en-short';
dayjs.locale(
  {
    ...en,
    name: SHORT_LOCALE,
    relativeTime: {
      future: 'in %s',
      past: '%s ago',
      s: 'under 1m',
      m: '1m',
      mm: '%dm',
      h: '1h',
      hh: '%dh',
      d: '1d',
      dd: '%dd',
      M: '1mo',
      MM: '%dmo',
      y: '1y',
      yy: '%dy',
    },
  },
  null,
  true,
);

// "3 hours ago", "in 2 days".
export function fromNow(date, now = new Date()) {
  return dayjs(date).from(now);
}

// "Thu, Nov 12, 2026 5:09 PM": for tooltips and anywhere the exact time matters.
export function fullDate(date) {
  return dayjs(date).format('llll');
}

// The time between now and `date` in the compact form, without "ago" or "in": "2h", "25m".
export function shortDuration(date, now = new Date()) {
  return dayjs(date).locale(SHORT_LOCALE).from(now, true);
}
