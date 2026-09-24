import type { AvatarRenderer, AvatarRendererProps } from './avatar-types';
import { LocalAvatarRenderer } from './local-avatar-renderer';

export type { AvatarRenderer, AvatarRendererProps } from './avatar-types';

/**
 * The seam every avatar renderer plugs into. A renderer is a component that
 * takes the profile-derived `AvatarRenderInput` (and the words to describe
 * it) and draws it — nothing about *how* leaks back into the body profile.
 *
 *   AvatarRenderer
 *   └── LocalAvatarRenderer        today: SVG in the browser, no network
 *   (later, not built here)
 *   ├── a 3D renderer              (clothing P03)
 *   └── an external / generated    (clothing P05, optional, behind its own
 *       renderer                    provider abstraction)
 *
 * Adding one is a new entry in `AVATAR_RENDERERS`; the page asks for a kind,
 * never for a specific component.
 */

export type AvatarRendererKind = 'local';

const AVATAR_RENDERERS: Record<AvatarRendererKind, AvatarRenderer> = {
  local: LocalAvatarRenderer,
};

export function AvatarPreview({
  kind = 'local',
  ...props
}: AvatarRendererProps & { kind?: AvatarRendererKind }) {
  const Renderer = AVATAR_RENDERERS[kind];
  return <Renderer {...props} />;
}
