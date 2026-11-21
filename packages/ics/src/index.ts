/**
 * `@shift/ics` (AD-20; story 16.4): the RFC 5545 subset Shift writes, by
 * hand. Pure: no runtime dependency but `@shift/domain`, no I/O, no clock.
 */

export {
  CALENDAR_NAME,
  DOWNLOAD_UID_DOMAIN,
  FEED_UID_DOMAIN,
  PRODUCT_ID,
  SUMMARY_SEPARATOR,
  calendarOf,
  type CalendarRequest,
  type UidDomain,
} from './calendar.js';

export { CRLF, MAX_LINE_OCTETS, contentOf, escapeText, foldLine } from './text.js';

export {
  CONSTANT_OFFSET_START,
  TRANSITION_LOOKBACK_DAYS,
  dateAfter,
  localDateTimeOf,
  observancesOf,
  timeZoneLines,
  utcDateTimeOf,
  utcOffsetOf,
  type Observance,
  type ObservanceKind,
} from './timezone.js';
