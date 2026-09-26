import type { AvatarRenderer, AvatarRendererProps } from './avatar-types';
import { BasicAvatarRenderer } from './basic-avatar-renderer';
import { LocalAvatarRenderer } from './local-avatar-renderer';

export type { AvatarRenderer, AvatarRendererProps } from './avatar-types';

/**
 * The seam every avatar renderer plugs into. A renderer is a component that
 * takes the profile-derived `AvatarRenderInput` (plus the words that
 * describe it, and any garment layers) and draws it — nothing about *how*
 * leaks back into the body profile or the fitting room.
 *
 *   AvatarRenderer
 *   ├── local   LocalAvatarRenderer — layered SVG over the body rig
 *   │           (clothing P03); the default, and the one garments dress
 *   └── basic   BasicAvatarRenderer — P01's flat SVG figure, no layers
 *
 *   Not built, and nothing here depends on them — each would be one more
 *   entry below, receiving exactly the same props:
 *   ├── ThreeJSAvatarRenderer   a 3D figure from the same rig
 *   ├── ExternalAvatarRenderer  an outside avatar service
 *   └── AIAvatarRenderer        generated imagery (P05's optional provider
 *                               architecture, never required)
 *
 * The page asks for a kind, never for a component; an unknown kind falls
 * back to `local` rather than drawing nothing.
 */

export const AVATAR_RENDERERS = {
  local: LocalAvatarRenderer,
  basic: BasicAvatarRenderer,
} as const satisfies Record<string, AvatarRenderer>;

export type AvatarRendererKind = keyof typeof AVATAR_RENDERERS;
export const DEFAULT_AVATAR_RENDERER: AvatarRendererKind = 'local';

export function isAvatarRendererKind(kind: string | undefined): kind is AvatarRendererKind {
  return kind !== undefined && Object.hasOwn(AVATAR_RENDERERS, kind);
}

export function resolveAvatarRenderer(kind: string | undefined): AvatarRenderer {
  return AVATAR_RENDERERS[isAvatarRendererKind(kind) ? kind : DEFAULT_AVATAR_RENDERER];
}

export function AvatarPreview({
  kind = DEFAULT_AVATAR_RENDERER,
  ...props
}: AvatarRendererProps & { kind?: string }) {
  // Looked up in the module-level registry, never created during render.
  const Renderer = AVATAR_RENDERERS[isAvatarRendererKind(kind) ? kind : DEFAULT_AVATAR_RENDERER];
  return <Renderer {...props} />;
}
