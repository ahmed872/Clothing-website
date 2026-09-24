import type { ReactElement } from 'react';

import type { AvatarRenderInput } from '@/lib/avatar/avatar-model';

/** What every avatar renderer receives — see `avatar-renderer.tsx`. */
export interface AvatarRendererProps {
  input: AvatarRenderInput;
  /** Accessible name, e.g. "Your avatar". */
  title: string;
  /** Accessible description of what is drawn, in the page's language. */
  description: string;
  /** The height as the page words it ("177 cm"), shown by the figure. */
  heightLabel: string;
  direction: 'rtl' | 'ltr';
}

export type AvatarRenderer = (props: AvatarRendererProps) => ReactElement;
