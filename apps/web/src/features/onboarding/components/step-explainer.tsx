import type { ReactNode } from 'react';

import { Callout, CalloutBody, CalloutDescription, CalloutTitle } from '@/components/ui/callout';
import { Info } from '@/components/ui/icon';
import { IconTile } from '@/components/ui/icon-tile';

/**
 * STORY 19.4 (UX-DR67, DESIGN.md *concept explainer*): one Callout above a
 * step's shipped section, while its fact is missing. It explains the concept
 * with an organization-neutral example and proposes nothing to adopt: no
 * count, duration or name is ever pre-filled from it. The step folds it away
 * once its fact exists. The copy is the step's, already translated.
 */
export function StepExplainer({
  title,
  body,
  example,
}: {
  readonly title: string;
  readonly body: string;
  readonly example: string;
}): ReactNode {
  return (
    <Callout>
      <CalloutBody>
        <IconTile variant="primary">
          <Info />
        </IconTile>
        <div className="grid min-w-0 gap-1">
          <CalloutTitle>{title}</CalloutTitle>
          <CalloutDescription>{body}</CalloutDescription>
          <CalloutDescription>{example}</CalloutDescription>
        </div>
      </CalloutBody>
    </Callout>
  );
}
