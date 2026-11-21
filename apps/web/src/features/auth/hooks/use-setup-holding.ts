import { useNavigate } from '@tanstack/react-router';
import { useRef, useState } from 'react';

import { useEndSession } from '@/features/auth/hooks/use-end-session';
import { SIGN_OUT_FAILED } from '@/features/auth/services/sign-out';

/**
 * `/postavljanje`'s *Odjava* (stories 19.2, 19.3), through the one session end
 * the chrome and the set-password step use. Step 1's form is
 * `use-create-organization.ts`'s; this is only the way out beside it.
 */
export function useSetupHolding() {
  const navigate = useNavigate();
  const endSession = useEndSession();
  const leaving = useRef(false);
  const [signOutFailed, setSignOutFailed] = useState(false);

  async function leave(): Promise<void> {
    if (leaving.current) return;

    leaving.current = true;
    setSignOutFailed(false);

    try {
      const outcome = await endSession();

      if (!outcome.ok) {
        setSignOutFailed(true);

        return;
      }

      await navigate({ to: '/prijava' });
    } catch (cause) {
      console.error(SIGN_OUT_FAILED, cause);
      setSignOutFailed(true);
    } finally {
      leaving.current = false;
    }
  }

  return { signOutFailed, leave };
}
