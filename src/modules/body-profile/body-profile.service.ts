import type {
  AvatarConfiguration,
  BodyProfile,
  BodyProfileGender,
  BodyShape,
  FacialHair,
  GlassesFrameColor,
  GlassesStyle,
  HairColor,
  HairStyle,
  Prisma,
  SkinTone,
} from '@generated/prisma';

import { AppError, db } from '@/modules/core';

import { deriveBodyShape } from './body-shape.service';
import { MEASUREMENT_KEYS, type MeasurementKey } from './options';
import { bodyProfileInputSchema, type BodyProfileInput } from './schemas';

/**
 * A customer's body profile and avatar — read, saved and deleted by the
 * *customer id*, and nothing else.
 *
 * There is deliberately no function here that takes a profile id or an
 * avatar id: the only handle on a profile is the customer it belongs to,
 * and the only caller that supplies that is the account action, which reads
 * it from the signed-in session (`requireCustomerAccount`). So "customer A
 * edits customer B's profile" has no parameter to smuggle B's id into — the
 * IDOR is closed by the shape of the API, and the tests prove it anyway.
 *
 * Nothing here logs a measurement or an appearance choice.
 */

export interface AvatarConfigurationView {
  skinTone: SkinTone | null;
  hairStyle: HairStyle | null;
  hairColor: HairColor | null;
  facialHair: FacialHair | null;
  wearsGlasses: boolean;
  glassesStyle: GlassesStyle | null;
  glassesFrameColor: GlassesFrameColor | null;
}

export type BodyMeasurements = Record<MeasurementKey, number | null> & {
  heightCm: number;
  weightKg: number;
  waistCm: number;
};

export interface BodyProfileView {
  gender: BodyProfileGender;
  measurements: BodyMeasurements;
  /** Derived and advisory — see `body-shape.service.ts`. */
  bodyShape: BodyShape | null;
  avatar: AvatarConfigurationView;
  /** The version a later save must name to be accepted (optimistic
   * concurrency, the same `updatedAt` discipline `updateProduct` uses). */
  updatedAt: Date;
}

/** What a client component receives — the same data, with the timestamp as
 * a string so it can round-trip through a form field unchanged. */
export type BodyProfileSnapshot = Omit<BodyProfileView, 'updatedAt'> & { updatedAt: string };

const EMPTY_AVATAR: AvatarConfigurationView = {
  skinTone: null,
  hairStyle: null,
  hairColor: null,
  facialHair: null,
  wearsGlasses: false,
  glassesStyle: null,
  glassesFrameColor: null,
};

function toNumber(value: Prisma.Decimal | null): number | null {
  return value === null ? null : value.toNumber();
}

function toView(profile: BodyProfile & { avatar: AvatarConfiguration | null }): BodyProfileView {
  const measurements = Object.fromEntries(
    MEASUREMENT_KEYS.map((key) => [key, toNumber(profile[key])]),
  ) as BodyMeasurements;
  const avatar = profile.avatar;
  return {
    gender: profile.gender,
    measurements,
    bodyShape: profile.bodyShape,
    avatar: avatar
      ? {
          skinTone: avatar.skinTone,
          hairStyle: avatar.hairStyle,
          hairColor: avatar.hairColor,
          facialHair: avatar.facialHair,
          wearsGlasses: avatar.wearsGlasses,
          glassesStyle: avatar.glassesStyle,
          glassesFrameColor: avatar.glassesFrameColor,
        }
      : { ...EMPTY_AVATAR },
    updatedAt: profile.updatedAt,
  };
}

export function serializeBodyProfile(view: BodyProfileView): BodyProfileSnapshot {
  return { ...view, updatedAt: view.updatedAt.toISOString() };
}

/** One query — the avatar comes back with the profile, never as a second
 * round trip. */
export async function getBodyProfile(customerId: string): Promise<BodyProfileView | null> {
  const profile = await db.bodyProfile.findUnique({
    where: { customerId },
    include: { avatar: true },
  });
  return profile ? toView(profile) : null;
}

export interface SaveBodyProfileOptions {
  /**
   * The version the customer's form was showing: the profile's `updatedAt`,
   * or `null` if the form was opened before any profile existed. When given,
   * a save made against anything else (another tab saved in between, or
   * deleted the profile) is refused with `CONFLICT` instead of silently
   * overwriting it. Omit only from callers with no form to be stale.
   */
  expectedUpdatedAt?: Date | null;
}

function staleConflict(): AppError {
  return new AppError('CONFLICT', { internalMessage: 'Stale body profile save' });
}

/**
 * Creates or replaces the customer's profile and avatar in one transaction.
 * The input is parsed here as well as in the action — the database is only
 * ever written with values `bodyProfileInputSchema` accepted — and
 * `bodyShape` is derived, never taken from the caller.
 */
export async function saveBodyProfile(
  customerId: string,
  input: BodyProfileInput,
  options: SaveBodyProfileOptions = {},
): Promise<BodyProfileView> {
  const data = bodyProfileInputSchema.parse(input);
  const { avatar, ...measurementsAndGender } = data;
  const profileData = {
    ...measurementsAndGender,
    bodyShape: deriveBodyShape(data),
  };

  try {
    return await db.$transaction(async (tx) => {
      const existing = await tx.bodyProfile.findUnique({ where: { customerId } });
      const expected = options.expectedUpdatedAt;

      let profileId: string;
      if (existing) {
        if (expected === null) throw staleConflict();
        if (expected && existing.updatedAt.getTime() !== expected.getTime()) throw staleConflict();
        // Conditional on the version just read, so two saves racing past
        // the check above cannot both win: the second matches no row.
        const updated = await tx.bodyProfile.updateMany({
          where: { id: existing.id, updatedAt: existing.updatedAt },
          data: profileData,
        });
        if (updated.count !== 1) throw staleConflict();
        profileId = existing.id;
      } else {
        if (expected) throw staleConflict();
        const created = await tx.bodyProfile.create({ data: { customerId, ...profileData } });
        profileId = created.id;
      }

      await tx.avatarConfiguration.upsert({
        where: { bodyProfileId: profileId },
        create: { bodyProfileId: profileId, ...avatar },
        update: avatar,
      });

      const saved = await tx.bodyProfile.findUniqueOrThrow({
        where: { id: profileId },
        include: { avatar: true },
      });
      return toView(saved);
    });
  } catch (error) {
    // A concurrent first save for the same customer loses on the unique
    // `customer_id` — the same "someone else saved first" outcome.
    if (isUniqueViolation(error)) throw staleConflict();
    // No such customer — only reachable by a caller not using the session.
    if (isForeignKeyViolation(error)) {
      throw new AppError('NOT_FOUND', { details: { entity: 'Customer' } });
    }
    throw error;
  }
}

/** Removes the profile and, by cascade, its avatar. Returns whether there
 * was one to remove; deleting nothing is not an error. */
export async function deleteBodyProfile(customerId: string): Promise<boolean> {
  const { count } = await db.bodyProfile.deleteMany({ where: { customerId } });
  return count > 0;
}

function prismaCode(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null && 'code' in error
    ? String((error as { code: unknown }).code)
    : undefined;
}

function isUniqueViolation(error: unknown): boolean {
  return prismaCode(error) === 'P2002';
}

function isForeignKeyViolation(error: unknown): boolean {
  return prismaCode(error) === 'P2003';
}
