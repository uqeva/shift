import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';

import {
  REMINDER_CHANNELS_KEY,
  REMINDER_CHANNELS_RPC,
  REMINDER_SETTINGS_KEY,
  REMINDER_SETTINGS_TABLE,
  REMINDER_SETTINGS_UNAVAILABLE,
  readReminderChannels,
  readReminderSettings,
  remindersViewOf,
  writeReminderSettings,
  type ReminderBackend,
  type ReminderChoice,
  type ReminderSettingsOutcome,
} from '@/features/notifications/services/reminders';
import { MEMBERS_TABLE, type OneKeyTable, type SettingsTable } from '@/features/notifications/services/settings';
import { writesOnline } from '@/lib/offline/use-write-gate';
import { currentSession, supabaseClient } from '@/lib/supabase/client';

/** The two tables and the RPC, built inside a query or write function, never at render. */
function backend(): ReminderBackend {
  const client = supabaseClient();
  return {
    members: () => client.from(MEMBERS_TABLE) as unknown as OneKeyTable,
    settings: () => client.from(REMINDER_SETTINGS_TABLE) as unknown as SettingsTable,
    channels: () => client.rpc(REMINDER_CHANNELS_RPC),
  };
}

/**
 * `/obavijesti`'s *Podsjetnici* (story 17.1): the member's own choice and the
 * channel line, and the one write.
 *
 * EACH SWITCH SAVES AT ONCE, as the screen's other controls do: while the
 * write is in flight the chosen value is drawn and the card is busy. A refusal
 * or a fault draws the stored value again with the failure notice. A landed
 * write sets the cache to what the database answered, says so, and reads the
 * channels again. Offline nothing is sent (the write gate's note says why).
 */
export function useReminderSettings() {
  const queryClient = useQueryClient();
  const read = useQuery({
    queryKey: REMINDER_SETTINGS_KEY,
    queryFn: () => readReminderSettings(backend(), currentSession),
    retry: false,
  });
  const channels = useQuery({
    queryKey: REMINDER_CHANNELS_KEY,
    queryFn: () => readReminderChannels(backend()),
    retry: false,
  });

  const saving = useRef(false);
  const [pending, setPending] = useState<ReminderChoice | null>(null);
  const [failed, setFailed] = useState(false);
  const [saved, setSaved] = useState(false);

  const outcome = read.data;
  const view = remindersViewOf(read.isError ? { ok: false, code: REMINDER_SETTINGS_UNAVAILABLE } : outcome);

  async function save(choice: ReminderChoice): Promise<void> {
    if (saving.current || outcome === undefined || !outcome.ok) return;
    if (!writesOnline()) return;

    saving.current = true;
    setPending(choice);
    setFailed(false);
    setSaved(false);

    try {
      // An older refetch still in flight must not land over this write's answer.
      await queryClient.cancelQueries({ queryKey: REMINDER_SETTINGS_KEY, exact: true });
      const written = await writeReminderSettings(backend(), outcome.settings, choice);

      if (!written.ok) {
        setFailed(true);
        // Read the row again, so the switches return to what the database
        // holds now (another tab may have written it: the last write wins).
        void queryClient.invalidateQueries({ queryKey: REMINDER_SETTINGS_KEY, exact: true });
        return;
      }

      const landed: ReminderSettingsOutcome = { ok: true, settings: { ...outcome.settings, ...written.choice } };
      queryClient.setQueryData(REMINDER_SETTINGS_KEY, landed);
      setSaved(true);
      void queryClient.invalidateQueries({ queryKey: REMINDER_CHANNELS_KEY });
    } finally {
      saving.current = false;
      setPending(null);
    }
  }

  async function retry(): Promise<void> {
    if (read.isFetching) return;
    await Promise.all([read.refetch(), channels.refetch()]);
  }

  return {
    view,
    /**
     * The channels, or `null` while they are read (again, after an
     * invalidation: no stale line) or when their read failed (the line is
     * left out).
     */
    channels: channels.isFetching ? null : (channels.data ?? null),
    /** The choice being written, or `null` when no write is in flight. */
    pending,
    failed,
    saved,
    save,
    retry,
    retrying: read.isFetching,
  };
}

export type ReminderSettingsState = ReturnType<typeof useReminderSettings>;
