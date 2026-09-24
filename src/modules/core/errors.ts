import { ZodError } from 'zod';

/**
 * One error type for the whole platform.
 *
 * Every expected failure carries a stable `code`, an HTTP status, and a
 * bilingual message written for the person reading it — what went wrong and
 * what to do next. Unexpected failures stay unexpected: they are not wrapped
 * into a friendly message, they are logged and surfaced as INTERNAL.
 */

export const ERROR_CODES = [
  'INTERNAL',
  'NOT_FOUND',
  'VALIDATION_FAILED',
  'UNAUTHENTICATED',
  'FORBIDDEN',
  'RATE_LIMITED',
  'CONFLICT',
  'OUT_OF_STOCK',
  'COUPON_INVALID',
  'COUPON_EXPIRED',
  'COUPON_LIMIT_REACHED',
  'PRICE_CHANGED',
  'PAYMENT_FAILED',
  'INVALID_STATE_TRANSITION',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export interface UserMessage {
  ar: string;
  en: string;
}

interface ErrorDefinition {
  httpStatus: number;
  message: UserMessage;
}

const ERROR_DEFINITIONS: Record<ErrorCode, ErrorDefinition> = {
  INTERNAL: {
    httpStatus: 500,
    message: {
      ar: 'حدث خطأ غير متوقع. حاول مرة أخرى، وإن تكرر تواصل معنا.',
      en: 'Something went wrong on our side. Try again, and contact us if it keeps happening.',
    },
  },
  NOT_FOUND: {
    httpStatus: 404,
    message: {
      ar: 'العنصر المطلوب غير موجود أو لم يعد متاحًا.',
      en: 'That item does not exist or is no longer available.',
    },
  },
  VALIDATION_FAILED: {
    httpStatus: 422,
    message: {
      ar: 'بعض البيانات غير صحيحة. راجع الحقول المميّزة وأعد المحاولة.',
      en: 'Some details are not valid. Check the highlighted fields and try again.',
    },
  },
  UNAUTHENTICATED: {
    httpStatus: 401,
    message: {
      ar: 'يلزم تسجيل الدخول للمتابعة.',
      en: 'Sign in to continue.',
    },
  },
  FORBIDDEN: {
    httpStatus: 403,
    message: {
      ar: 'لا تملك صلاحية تنفيذ هذا الإجراء.',
      en: 'You do not have permission to do that.',
    },
  },
  RATE_LIMITED: {
    httpStatus: 429,
    message: {
      ar: 'محاولات كثيرة خلال وقت قصير. انتظر قليلًا ثم أعد المحاولة.',
      en: 'Too many attempts in a short time. Wait a moment and try again.',
    },
  },
  CONFLICT: {
    httpStatus: 409,
    message: {
      ar: 'تم تعديل هذا العنصر من مكان آخر. حدّث الصفحة وأعد المحاولة.',
      en: 'This item changed somewhere else. Refresh and try again.',
    },
  },
  OUT_OF_STOCK: {
    httpStatus: 409,
    message: {
      ar: 'الكمية المطلوبة لم تعد متوفّرة. عدّل الكمية وأعد المحاولة.',
      en: 'The requested quantity is no longer available. Adjust the quantity and try again.',
    },
  },
  COUPON_INVALID: {
    httpStatus: 422,
    message: {
      ar: 'هذا الكوبون غير صالح لطلبك.',
      en: 'This coupon is not valid for your order.',
    },
  },
  COUPON_EXPIRED: {
    httpStatus: 422,
    message: {
      ar: 'انتهت صلاحية هذا الكوبون.',
      en: 'This coupon has expired.',
    },
  },
  COUPON_LIMIT_REACHED: {
    httpStatus: 422,
    message: {
      ar: 'تم استخدام هذا الكوبون بالحد المسموح.',
      en: 'This coupon has reached its usage limit.',
    },
  },
  PRICE_CHANGED: {
    httpStatus: 409,
    message: {
      ar: 'تغيّر سعر أحد المنتجات منذ إضافته للسلة. راجع الإجمالي الجديد قبل المتابعة.',
      en: 'A price changed since you added the item. Review the new total before continuing.',
    },
  },
  PAYMENT_FAILED: {
    httpStatus: 402,
    message: {
      ar: 'لم تكتمل عملية الدفع. لم يُخصم أي مبلغ، ويمكنك المحاولة بوسيلة أخرى.',
      en: 'The payment did not go through. Nothing was charged — you can try another method.',
    },
  },
  INVALID_STATE_TRANSITION: {
    httpStatus: 409,
    message: {
      ar: 'لا يمكن تنفيذ هذا التغيير على الحالة الحالية للطلب.',
      en: 'That change is not allowed from the order’s current status.',
    },
  },
};

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly httpStatus: number;
  readonly userMessage: UserMessage;
  readonly details: Readonly<Record<string, unknown>> | undefined;

  constructor(
    code: ErrorCode,
    options: { cause?: unknown; details?: Record<string, unknown>; internalMessage?: string } = {},
  ) {
    const definition = ERROR_DEFINITIONS[code];
    super(options.internalMessage ?? `${code}: ${definition.message.en}`, { cause: options.cause });
    this.name = 'AppError';
    this.code = code;
    this.httpStatus = definition.httpStatus;
    this.userMessage = definition.message;
    this.details = options.details;
  }

  /** The message to show the person, in their language. */
  messageFor(locale: 'ar' | 'en'): string {
    return this.userMessage[locale];
  }
}

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}

/**
 * Normalise anything thrown into an AppError. Unknown failures become
 * INTERNAL and keep the original error as `cause` for the logs — the caller
 * never sees raw internals.
 *
 * A raw `ZodError` is the one deliberate exception: every service in this
 * codebase validates its input with `schema.parse(input)` rather than
 * `safeParse` (see catalog's and media's `*.service.ts` files), so a bad
 * request surfaces as a thrown `ZodError`, not an `AppError`. Falling
 * through to INTERNAL here would turn every validation failure — a bad
 * slug, a missing field, an out-of-range price — into a 500 the caller has
 * no way to distinguish from an actual bug. It is one, structurally, so it
 * gets the same treatment `VALIDATION_FAILED` already gets everywhere else.
 */
export function toAppError(error: unknown): AppError {
  if (isAppError(error)) return error;
  if (error instanceof ZodError) {
    return new AppError('VALIDATION_FAILED', {
      cause: error,
      details: {
        issues: error.issues.map((issue) => ({ path: issue.path, message: issue.message })),
      },
    });
  }
  return new AppError('INTERNAL', { cause: error });
}
