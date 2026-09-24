import { z } from 'zod';

import { ALLOWED_IMAGE_MIME_TYPES, MAX_UPLOAD_BYTES } from './provider';

/**
 * `context` names *why* an upload is happening, not who's doing it (there is
 * no user-auth system yet — that's P06). It scopes the storage key
 * (`media/<context>/<uuid>.<ext>`) and is the one thing "unauthorized
 * upload" means at this layer: a context this service doesn't recognise is
 * rejected before a signed URL is ever issued.
 */
export const uploadContextSchema = z.enum(['product', 'category', 'brand', 'homepage', 'branding']);
export type UploadContext = z.infer<typeof uploadContextSchema>;

export const requestUploadInputSchema = z.object({
  context: uploadContextSchema,
  contentType: z.enum(ALLOWED_IMAGE_MIME_TYPES),
  sizeBytes: z.number().int().positive().max(MAX_UPLOAD_BYTES),
  altAr: z.string().min(1).max(500).nullable().optional(),
  altEn: z.string().min(1).max(500).nullable().optional(),
});
export type RequestUploadInput = z.infer<typeof requestUploadInputSchema>;

export const confirmUploadInputSchema = z.object({
  key: z.string().min(1),
});
export type ConfirmUploadInput = z.infer<typeof confirmUploadInputSchema>;

export const updateAltTextInputSchema = z.object({
  altAr: z.string().min(1).max(500).nullable().optional(),
  altEn: z.string().min(1).max(500).nullable().optional(),
});
export type UpdateAltTextInput = z.infer<typeof updateAltTextInputSchema>;
