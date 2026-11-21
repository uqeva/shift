import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';

import { useCalendarSnapshot } from '@/features/calendar/hooks/use-calendar-snapshot';
import { calendarTodayOf, monthHeaderOf, type MonthHeader } from '@/features/calendar/utils/month';
import {
  ICS_MIME,
  MONTH_DOWNLOAD_LOADING,
  MONTH_DOWNLOAD_READY,
  MONTH_DOWNLOAD_UNAVAILABLE,
  boundedMonthOf,
  monthDownloadOf,
  monthDownloadReadinessOf,
  monthWithinReach,
  type MonthDownloadFailure,
} from '@/features/calendar-feed/services/month-download';
import { myLeaveRecordsQueryOptions, type MyLeaveRecordsRpc } from '@/features/leave/services/leave-list';
import { saveTextFile } from '@/features/calendar-feed/utils/save-file';
import { supabaseClient } from '@/lib/supabase/client';

/**
 * The month download on *Kalendar na mobitelu* (story 16.5): the month shown,
 * moved by the shared month control within twelve months either side of the
 * current one, and *Preuzmi* that builds the file from what the browser
 * already holds — the calendar snapshot under its one key and the viewer's
 * own leave under theirs (both kept on the device, so the download works
 * offline too) — through `monthDownloadOf`. No request of its own and no
 * write. A month with no working shift makes no file and says so.
 */
export function useMonthDownload() {
  const snapshotRead = useCalendarSnapshot();
  const leaveRead = useQuery(myLeaveRecordsQueryOptions(() => supabaseClient() as unknown as MyLeaveRecordsRpc));
  const [chosen, setChosen] = useState<string | null>(null);
  const [failure, setFailure] = useState<MonthDownloadFailure | null>(null);
  const [started, setStarted] = useState<string | null>(null);

  const snapshot = snapshotRead.data;
  const rows = leaveRead.data;
  const readiness = monthDownloadReadinessOf(
    { held: snapshot !== undefined, isError: snapshotRead.isError, fetchStatus: snapshotRead.fetchStatus },
    { held: rows !== undefined, isError: leaveRead.isError, fetchStatus: leaveRead.fetchStatus },
  );
  let month: MonthHeader | null = null;
  if (snapshot !== undefined) {
    const today = calendarTodayOf(snapshot, new Date());
    try {
      month = boundedMonthOf(monthHeaderOf(chosen ?? today.slice(0, 7), today));
    } catch {
      month = null;
    }
  }

  return {
    month,
    /** The organization's zone, once the snapshot is read (L8): the last fetch is told in it. */
    timeZone: snapshot?.timeZone ?? null,
    loading: readiness === MONTH_DOWNLOAD_LOADING,
    /** A read failed, or is paused offline, with nothing on the device to build from. */
    unavailable: readiness === MONTH_DOWNLOAD_UNAVAILABLE,
    failure,
    /** The file the last *Preuzmi* handed the browser. */
    started,
    show: (next: string | null) => {
      // The picker can name a month past the reach; it is not taken.
      if (next !== null && month !== null && !monthWithinReach(next, month.current)) return;
      setChosen(next);
      setFailure(null);
      setStarted(null);
    },
    download: () => {
      if (readiness !== MONTH_DOWNLOAD_READY || snapshot === undefined || rows === undefined || month === null) return;

      const file = monthDownloadOf(snapshot, rows, month.month, Date.now());

      if (!file.ok) {
        setFailure(file.code);
        setStarted(null);
        return;
      }

      saveTextFile(file.fileName, file.text, ICS_MIME);
      setFailure(null);
      setStarted(file.fileName);
    },
    retry: () => {
      if (snapshot === undefined) void snapshotRead.refetch();
      if (rows === undefined) void leaveRead.refetch();
    },
  };
}

export type MonthDownloadState = ReturnType<typeof useMonthDownload>;
