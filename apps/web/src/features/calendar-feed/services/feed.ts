import { formatDate, formatTime, isRenderableTimeZone } from '@/lib/i18n/format';

/**
 * *Kalendar na mobitelu* (story 16.5; FR-80, FR-82; UX-DR54, UX-DR55): the
 * member's own calendar link and an admin's view of a member's, over 0067's
 * five functions. Pure: the client is a parameter, so every outcome runs in
 * the node suite (AD-15).
 *
 * THE TOKEN IS A CREDENTIAL (D-S1). `create_calendar_feed_token` answers it
 * once; this module hands it back to the caller and keeps it nowhere: never in
 * a query key or value, never in a log line or an error. The state reads
 * answer `{ live, created_at, last_fetched_at }` only, and
 * {@link feedStateOf} keeps exactly those three, so a later visit can show the
 * state and never a URL.
 */

/** The member's own state, and an admin's read of a member's (0067). */
export const CALENDAR_FEED_STATUS_FUNCTION = 'calendar_feed_status';
export const MEMBER_CALENDAR_FEED_STATUS_FUNCTION = 'member_calendar_feed_status';
/** Revokes any live link of the caller's and answers a new token, once. */
export const CREATE_CALENDAR_FEED_TOKEN_FUNCTION = 'create_calendar_feed_token';
export const REVOKE_OWN_CALENDAR_FEED_TOKEN_FUNCTION = 'revoke_own_calendar_feed_token';
export const REVOKE_MEMBER_CALENDAR_FEED_TOKEN_FUNCTION = 'revoke_member_calendar_feed_token';

/** The one key the viewer's own state is read under. Never persisted (`persistsKey` keeps an allowlist). */
export const CALENDAR_FEED_KEY = ['calendar-feed'] as const;

/** The key an admin's read of one member's state is under. */
export function MEMBER_CALENDAR_FEED_KEY(memberId: string): readonly ['member-calendar-feed', string] {
  return ['member-calendar-feed', memberId];
}

/** The path the `calendar-feed` function serves under the project URL (AD-14). */
export const FEED_PATH = '/functions/v1/calendar-feed/';
/** The file extension every feed URL ends in. */
export const FEED_EXTENSION = '.ics';
/** Google Calendar's add-by-URL entry (the web app; its phone app cannot subscribe by URL). */
export const GOOGLE_SUBSCRIBE_URL = 'https://calendar.google.com/calendar/r?cid=';
/** What the masked URL shows in place of the token: a fixed run, so not even its length is shown. */
export const MASK = '••••••••••••';
/** Between the origin and the feed path in the masked URL. */
export const MASK_ELLIPSIS = '…';

/** 32 bytes as unpadded base64url (AD-14): exactly what 0067 returns. */
const TOKEN_SHAPE = /^[A-Za-z0-9_-]{43}$/;

/** The read or write could not be answered: transport, an unexpected error, or a malformed answer. */
export const CALENDAR_FEED_UNAVAILABLE = 'CALENDAR_FEED_UNAVAILABLE';
/** 0067's 42501 `CALENDAR_FEED_REFUSED`: no member of the claimed organization, inactive, or not an admin. */
export const CALENDAR_FEED_REFUSED = 'CALENDAR_FEED_REFUSED';
/** 0067's P0002 `CALENDAR_FEED_MEMBER_UNKNOWN`: an admin's read or turn-off of a member not in the organization. */
export const CALENDAR_FEED_MEMBER_UNKNOWN = 'CALENDAR_FEED_MEMBER_UNKNOWN';

export type CalendarFeedFailure =
  | typeof CALENDAR_FEED_UNAVAILABLE
  | typeof CALENDAR_FEED_REFUSED
  | typeof CALENDAR_FEED_MEMBER_UNKNOWN;

/** A feed's state, as both reads answer it. No token, no hash, no id. */
export interface FeedState {
  readonly live: boolean;
  /** When the live link was made, ISO; `null` when none is live. */
  readonly createdAt: string | null;
  /** When a calendar last fetched the live link, ISO; `null` when none has, or none is live. */
  readonly lastFetchedAt: string | null;
}

export type FeedStateOutcome =
  | { readonly ok: true; readonly state: FeedState }
  | { readonly ok: false; readonly code: CalendarFeedFailure };

export type FeedCreateOutcome =
  | { readonly ok: true; readonly token: string }
  | { readonly ok: false; readonly code: CalendarFeedFailure };

export type FeedRevokeOutcome = { readonly ok: true } | { readonly ok: false; readonly code: CalendarFeedFailure };

/** The PostgREST answer this module reads. */
interface Answer {
  readonly data: unknown;
  // `| undefined` spelled out: `exactOptionalPropertyTypes` is on.
  readonly error: { readonly code?: string | undefined; readonly message?: string | undefined } | null;
}

/** The one call made here, named structurally so it can be stubbed. */
export interface FeedRpc {
  rpc(fn: string, args?: Readonly<Record<string, unknown>>): PromiseLike<Answer>;
}

const INSUFFICIENT_PRIVILEGE = '42501';
const NO_DATA_FOUND = 'P0002';

function failureOf(error: NonNullable<Answer['error']>): CalendarFeedFailure {
  if (error.code === INSUFFICIENT_PRIVILEGE) return CALENDAR_FEED_REFUSED;
  if (error.code === NO_DATA_FOUND) return CALENDAR_FEED_MEMBER_UNKNOWN;

  return CALENDAR_FEED_UNAVAILABLE;
}

const isStamp = (value: unknown): value is string => typeof value === 'string' && !Number.isNaN(Date.parse(value));

/**
 * The state from a read's answer, or `null` when it is not one: `live` a
 * boolean, each stamp an ISO instant or null, a live state carrying its
 * creation, a state not live carrying neither. Anything else the object holds
 * is dropped.
 */
export function feedStateOf(data: unknown): FeedState | null {
  if (typeof data !== 'object' || data === null || Array.isArray(data)) return null;

  const row = data as Record<string, unknown>;
  const live = row['live'];
  const created = row['created_at'] ?? null;
  const fetched = row['last_fetched_at'] ?? null;

  if (typeof live !== 'boolean') return null;
  if ((created !== null && !isStamp(created)) || (fetched !== null && !isStamp(fetched))) return null;
  if (live && created === null) return null;
  if (!live && (created !== null || fetched !== null)) return null;

  return { live, createdAt: created, lastFetchedAt: fetched };
}

async function readState(call: () => PromiseLike<Answer>): Promise<FeedStateOutcome> {
  try {
    const answer = await call();

    if (answer.error !== null) {
      const code = failureOf(answer.error);
      console.error(code, answer.error.code);
      return { ok: false, code };
    }

    const state = feedStateOf(answer.data);

    if (state === null) {
      console.error(CALENDAR_FEED_UNAVAILABLE, 'shape');
      return { ok: false, code: CALENDAR_FEED_UNAVAILABLE };
    }

    return { ok: true, state };
  } catch {
    // The cause is not logged: a transport failure carries nothing useful here.
    console.error(CALENDAR_FEED_UNAVAILABLE, 'transport');
    return { ok: false, code: CALENDAR_FEED_UNAVAILABLE };
  }
}

/** The viewer's own state. Never throws. */
export function readFeedState(client: FeedRpc): Promise<FeedStateOutcome> {
  return readState(() => client.rpc(CALENDAR_FEED_STATUS_FUNCTION));
}

/** An admin's read of one member's state. Never throws. */
export function readMemberFeedState(client: FeedRpc, memberId: string): Promise<FeedStateOutcome> {
  return readState(() => client.rpc(MEMBER_CALENDAR_FEED_STATUS_FUNCTION, { p_member: memberId }));
}

/**
 * Creates the viewer's link, or regenerates it (the old one dies in the same
 * transaction). The token is answered to the caller and nowhere else: a
 * failure logs its code only, never the answer. Never throws.
 */
export async function createFeedToken(client: FeedRpc): Promise<FeedCreateOutcome> {
  try {
    const answer = await client.rpc(CREATE_CALENDAR_FEED_TOKEN_FUNCTION);

    if (answer.error !== null) {
      const code = failureOf(answer.error);
      console.error(code, answer.error.code);
      return { ok: false, code };
    }

    if (typeof answer.data !== 'string' || !TOKEN_SHAPE.test(answer.data)) {
      console.error(CALENDAR_FEED_UNAVAILABLE, 'shape');
      return { ok: false, code: CALENDAR_FEED_UNAVAILABLE };
    }

    return { ok: true, token: answer.data };
  } catch {
    console.error(CALENDAR_FEED_UNAVAILABLE, 'transport');
    return { ok: false, code: CALENDAR_FEED_UNAVAILABLE };
  }
}

async function revoke(call: () => PromiseLike<Answer>): Promise<FeedRevokeOutcome> {
  try {
    const answer = await call();

    if (answer.error !== null) {
      const code = failureOf(answer.error);
      console.error(code, answer.error.code);
      return { ok: false, code };
    }

    return { ok: true };
  } catch {
    console.error(CALENDAR_FEED_UNAVAILABLE, 'transport');
    return { ok: false, code: CALENDAR_FEED_UNAVAILABLE };
  }
}

/** Turns the viewer's own link off; nothing live is no error. Never throws. */
export function revokeOwnFeed(client: FeedRpc): Promise<FeedRevokeOutcome> {
  return revoke(() => client.rpc(REVOKE_OWN_CALENDAR_FEED_TOKEN_FUNCTION));
}

/** An admin turns a member's link off. Never throws. */
export function revokeMemberFeed(client: FeedRpc, memberId: string): Promise<FeedRevokeOutcome> {
  return revoke(() => client.rpc(REVOKE_MEMBER_CALENDAR_FEED_TOKEN_FUNCTION, { p_member: memberId }));
}

// ------------------------------------------------------------------ the URLs

/** The feed URL and the two ways a phone adds it. */
export interface FeedUrls {
  /** `<project>/functions/v1/calendar-feed/<token>.ics`: what *Kopiraj* copies. */
  readonly https: string;
  /** The same as `webcal://`, which an iPhone opens as *Pretplati se*. */
  readonly webcal: string;
  /** Google Calendar on the web, the webcal URL prefilled. */
  readonly google: string;
}

/** The project URL without a trailing slash. */
function baseOf(projectUrl: string): string {
  return projectUrl.trim().replace(/\/+$/, '');
}

/**
 * The URLs for a token under the build's project URL (`VITE_SUPABASE_URL`).
 *
 * @throws RangeError when the token is not one 0067 issues or the project URL
 *   is not http(s); the message names neither.
 */
export function feedUrlsOf(projectUrl: string, token: string): FeedUrls {
  if (!TOKEN_SHAPE.test(token)) throw new RangeError('not a calendar feed token');

  const base = baseOf(projectUrl);

  if (!isFeedProjectUrl(base)) throw new RangeError('the project URL is not http(s)');

  const https = `${base}${FEED_PATH}${token}${FEED_EXTENSION}`;
  const webcal = https.replace(/^https?:/, 'webcal:');

  return { https, webcal, google: `${GOOGLE_SUBSCRIBE_URL}${encodeURIComponent(webcal)}` };
}

/**
 * What the screen shows until *Prikaži* (display only, against a look over
 * the shoulder): the project's origin, `…/calendar-feed/` and a fixed run of
 * dots for the token. Built from the project URL alone, so it holds nothing
 * of the token, not even its length.
 */
export function maskedFeedUrlOf(projectUrl: string): string {
  const base = baseOf(projectUrl);
  let origin = base;

  try {
    origin = new URL(base).origin;
  } catch {
    // Shown as configured; `feedUrlsOf` refuses it before any link is shown.
  }

  return `${origin}/${MASK_ELLIPSIS}/calendar-feed/${MASK}${FEED_EXTENSION}`;
}

/** The token a write answered, or `null`: a turn-off answers none, and a failure keeps nothing. */
export function issuedTokenOf(outcome: FeedCreateOutcome | FeedRevokeOutcome): string | null {
  return outcome.ok && 'token' in outcome ? outcome.token : null;
}

// ------------------------------------------------------------------ the stages

/** No confirmation open and no write in flight. */
export const FEED_IDLE = 'idle';
/** *Izradi novu poveznicu*'s confirmation is open. */
export const FEED_REGENERATE_ARMED = 'regenerateArmed';
/** *Isključi*'s confirmation is open. */
export const FEED_TURN_OFF_ARMED = 'turnOffArmed';
/** The first link is being made. */
export const FEED_CREATING = 'creating';
export const FEED_REGENERATING = 'regenerating';
export const FEED_TURNING_OFF = 'turningOff';

/** Which confirmation is open, or which write is in flight. */
export type FeedStage =
  | typeof FEED_IDLE
  | typeof FEED_REGENERATE_ARMED
  | typeof FEED_TURN_OFF_ARMED
  | typeof FEED_CREATING
  | typeof FEED_REGENERATING
  | typeof FEED_TURNING_OFF;

/** The three writes. */
export type FeedWrite = typeof FEED_CREATING | typeof FEED_REGENERATING | typeof FEED_TURNING_OFF;

/** Whether a write is in flight: every write control is busy then. */
export function feedBusy(stage: FeedStage): boolean {
  return stage === FEED_CREATING || stage === FEED_REGENERATING || stage === FEED_TURNING_OFF;
}

/** Where focus goes once a write lands: the shown link's heading, or the card's. */
export const FEED_FOCUS_LINK = 'link';
export const FEED_FOCUS_CARD = 'card';
export type FeedFocus = typeof FEED_FOCUS_LINK | typeof FEED_FOCUS_CARD;

/**
 * The link card's write state (story 16.5): the token this visit was shown,
 * the stage, the last refusal, whether a turn-off landed, and where focus
 * goes after the last landed write (`landed` counts landings, so the same
 * target twice still moves focus).
 */
export interface FeedWriteState {
  readonly token: string | null;
  readonly stage: FeedStage;
  readonly failure: CalendarFeedFailure | null;
  readonly turnedOff: boolean;
  readonly focus: FeedFocus | null;
  readonly landed: number;
}

export const FEED_WRITE_INITIAL: FeedWriteState = {
  token: null,
  stage: FEED_IDLE,
  failure: null,
  turnedOff: false,
  focus: null,
  landed: 0,
};

/** The armed stage a confirmed write returns to when it is refused: its dialog stays open. */
function armedStageOf(write: FeedWrite): FeedStage {
  if (write === FEED_REGENERATING) return FEED_REGENERATE_ARMED;
  if (write === FEED_TURNING_OFF) return FEED_TURN_OFF_ARMED;
  return FEED_IDLE;
}

/** A confirmation opened: any earlier refusal is cleared. */
export function feedArmed(state: FeedWriteState, stage: typeof FEED_REGENERATE_ARMED | typeof FEED_TURN_OFF_ARMED): FeedWriteState {
  return { ...state, stage, failure: null, turnedOff: false };
}

/** A confirmation closed without writing. */
export function feedCancelled(state: FeedWriteState): FeedWriteState {
  return feedBusy(state.stage) ? state : { ...state, stage: FEED_IDLE, failure: null };
}

/** A write sent: the stage is the write's, the earlier notices are cleared, the shown token kept. */
export function feedWriteStarted(state: FeedWriteState, write: FeedWrite): FeedWriteState {
  return { ...state, stage: write, failure: null, turnedOff: false };
}

/**
 * A write's answer, and whether the state must be read again (always: the
 * cache is never written from an answer, and a token never enters it).
 *
 * A landed create or regenerate holds the new token (its link drawn masked
 * again, keyed by the token) and moves focus to the link's heading; a landed
 * turn-off drops the token and moves focus to the card's heading. ANY failure,
 * a refusal or an unavailable answer alike, drops the shown token — a link
 * the database may have revoked never stays on screen — and keeps a confirmed
 * write's dialog open with the refusal in it.
 */
export function feedWriteSettled(
  state: FeedWriteState,
  write: FeedWrite,
  outcome: FeedCreateOutcome | FeedRevokeOutcome,
): { readonly state: FeedWriteState; readonly reread: true } {
  if (!outcome.ok) {
    return {
      state: { ...state, token: null, stage: armedStageOf(write), failure: outcome.code, turnedOff: false, focus: null },
      reread: true,
    };
  }

  const token = issuedTokenOf(outcome);

  return {
    state: {
      token,
      stage: FEED_IDLE,
      failure: null,
      turnedOff: token === null,
      focus: token === null ? FEED_FOCUS_CARD : FEED_FOCUS_LINK,
      landed: state.landed + 1,
    },
    reread: true,
  };
}

/**
 * Whether a project URL can carry a feed link: http(s) with a host. Checked
 * before a token is asked for, so an issued token is never left unshown.
 */
export function isFeedProjectUrl(projectUrl: string | null): projectUrl is string {
  if (projectUrl === null || !/^https?:\/\/[^/\s]/.test(baseOf(projectUrl))) return false;

  // A query or fragment would swallow the token's path: no link could be built on it.
  try {
    const url = new URL(baseOf(projectUrl));
    return url.search === '' && url.hash === '';
  } catch {
    return false;
  }
}

/** The admin card's write state (UX-DR55), on the link card's terms. */
export interface MemberFeedWriteState {
  readonly armed: boolean;
  readonly busy: boolean;
  readonly failure: CalendarFeedFailure | null;
  readonly turnedOff: boolean;
  /** Counts landed turn-offs; each moves focus to the card's heading. */
  readonly landed: number;
}

export const MEMBER_FEED_WRITE_INITIAL: MemberFeedWriteState = { armed: false, busy: false, failure: null, turnedOff: false, landed: 0 };

/** The admin's turn-off sent: busy, any earlier refusal cleared. */
export function memberFeedStarted(state: MemberFeedWriteState): MemberFeedWriteState {
  return { ...state, busy: true, failure: null };
}

/** The admin's confirmation closed without writing; never while the turn-off is in flight. */
export function memberFeedCancelled(state: MemberFeedWriteState): MemberFeedWriteState {
  return state.busy ? state : { ...state, armed: false, failure: null };
}

/**
 * Whether the admin card says the link is on: the read's answer, except that
 * a landed turn-off is not undone by a read from before it (`fresh` false)
 * while the re-read is under way.
 */
export function memberFeedLiveOf(outcome: FeedStateOutcome | undefined, turnedOff: boolean, fresh: boolean): boolean {
  if (turnedOff && !fresh) return false;
  return outcome !== undefined && outcome.ok && outcome.state.live;
}

/** *Isključi poveznicu* opens its confirmation only online and only while the link is live. */
export function memberFeedArmed(state: MemberFeedWriteState, online: boolean, live: boolean): MemberFeedWriteState {
  if (!online || !live || state.busy) return state;
  return { ...state, armed: true, failure: null, turnedOff: false };
}

/** The turn-off's answer: landed, the dialog closes; refused, it stays open with the refusal. A re-read always follows. */
export function memberFeedSettled(state: MemberFeedWriteState, outcome: FeedRevokeOutcome): { readonly state: MemberFeedWriteState; readonly reread: true } {
  if (!outcome.ok) return { state: { ...state, busy: false, armed: true, failure: outcome.code }, reread: true };
  return { state: { armed: false, busy: false, failure: null, turnedOff: true, landed: state.landed + 1 }, reread: true };
}

/**
 * The Google add link opens in a new tab: leaving this page would forget the
 * link it shows once. (The `webcal://` link hands off to the phone's calendar
 * and leaves the page where it is.)
 */
export const NEW_TAB_LINK = { target: '_blank', rel: 'noopener noreferrer' } as const;

// ------------------------------------------------------------------ the view

export const FEED_LOADING = 'loading';
export const FEED_UNAVAILABLE_VIEW = 'unavailable';
export const FEED_NONE = 'none';
export const FEED_LIVE = 'live';

/** What the subscription card draws, from the read alone. The URL is the hook's, never the view's. */
export type FeedView =
  | { readonly kind: typeof FEED_LOADING }
  | { readonly kind: typeof FEED_UNAVAILABLE_VIEW }
  | { readonly kind: typeof FEED_NONE }
  | { readonly kind: typeof FEED_LIVE; readonly lastFetchedAt: string | null };

/**
 * The view from the read, and from whether this visit holds a link: a held
 * link is live whatever the read says while it catches up, so *Izradi
 * poveznicu* is never offered beside a link just shown.
 */
export function feedViewOf(
  outcome: FeedStateOutcome | undefined,
  holdsLink = false,
  freshness: { readonly fresh: boolean; readonly turnedOff: boolean } = { fresh: true, turnedOff: false },
): FeedView {
  const live = outcome !== undefined && outcome.ok && outcome.state.live;

  // A landed turn-off is not undone by a read from before it.
  if (freshness.turnedOff && !freshness.fresh) return { kind: FEED_NONE };
  // A read from before the link was made says nothing of it, not even its last fetch.
  if (holdsLink && (!live || !freshness.fresh)) return { kind: FEED_LIVE, lastFetchedAt: null };
  if (outcome === undefined) return { kind: FEED_LOADING };
  if (!outcome.ok) return { kind: FEED_UNAVAILABLE_VIEW };
  if (!outcome.state.live) return { kind: FEED_NONE };

  return { kind: FEED_LIVE, lastFetchedAt: outcome.state.lastFetchedAt };
}

/**
 * Whether the link this visit holds was turned off elsewhere (by an admin, or
 * on another device): a read made after the write landed answers it not
 * live. The link is then dropped, never shown as working. A read that failed,
 * or one from before the write, says nothing of it.
 */
export function feedHeldLinkLost(outcome: FeedStateOutcome | undefined, holdsLink: boolean, fresh: boolean): boolean {
  return holdsLink && fresh && outcome !== undefined && outcome.ok && !outcome.state.live;
}

/** The held link dropped ({@link feedHeldLinkLost}); nothing else changes. */
export function feedLinkDropped(state: FeedWriteState): FeedWriteState {
  return state.token === null ? state : { ...state, token: null, focus: null };
}

/**
 * Which last-fetch line is said: none yet, the instant in the organization's
 * zone, or — while that zone is unknown or cannot be rendered — that a fetch
 * happened, with no time (never a silent fallback zone, L8).
 */
export function lastFetchedMessageKey(
  lastFetchedAt: string | null,
  zoneKnown: boolean,
): 'feed.neverFetched' | 'feed.lastFetched' | 'feed.fetched' {
  if (lastFetchedAt === null) return 'feed.neverFetched';
  return zoneKnown ? 'feed.lastFetched' : 'feed.fetched';
}

/** The last fetch, as one of its lines and the values the timed one takes. */
export interface LastFetchedLine {
  readonly key: ReturnType<typeof lastFetchedMessageKey>;
  readonly date: string;
  readonly time: string;
}

/** `Zadnje preuzimanje: {date} u {time}` in `zone`, `Poveznica je preuzeta.` without one, or `Još nije preuzeto.` */
export function lastFetchedLineOf(lastFetchedAt: string | null, zone: string | null): LastFetchedLine {
  const zoneKnown = zone !== null && isRenderableTimeZone(zone);
  const key = lastFetchedMessageKey(lastFetchedAt, zoneKnown);

  if (lastFetchedAt === null || zone === null || !zoneKnown) return { key, date: '', time: '' };

  const instant = new Date(lastFetchedAt);

  return { key, date: formatDate(instant, zone), time: formatTime(instant, zone) };
}

/** An admin's card line: `Kalendar na mobitelu: uključen / isključen` (UX-DR55). */
export function memberFeedLineMessageKey(live: boolean): 'feed.member.on' | 'feed.member.off' {
  return live ? 'feed.member.on' : 'feed.member.off';
}

/**
 * What a failed write says: a fault asks to try again, a refusal does not
 * (another try is refused the same), an unknown member its own.
 */
export function feedFailureMessageKey(code: CalendarFeedFailure): 'feed.writeFailed' | 'feed.refused' | 'feed.member.unknown' {
  if (code === CALENDAR_FEED_MEMBER_UNKNOWN) return 'feed.member.unknown';
  return code === CALENDAR_FEED_REFUSED ? 'feed.refused' : 'feed.writeFailed';
}

/** What the admin card says when its read fails: only an unavailable read offers a retry ({@link memberFeedReadRetryable}). */
export function memberFeedReadMessageKey(
  code: CalendarFeedFailure,
): 'feed.member.unavailable' | 'feed.member.refused' | 'feed.member.unknown' {
  if (code === CALENDAR_FEED_MEMBER_UNKNOWN) return 'feed.member.unknown';
  return code === CALENDAR_FEED_REFUSED ? 'feed.member.refused' : 'feed.member.unavailable';
}

export function memberFeedReadRetryable(code: CalendarFeedFailure): boolean {
  return code === CALENDAR_FEED_UNAVAILABLE;
}
