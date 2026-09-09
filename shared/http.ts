import { Type, type Static } from 'typebox';

export const ApiErrorSchema = Type.Object({
  error: Type.Object({
    code: Type.Union([
      Type.Literal('INVALID_REQUEST'), Type.Literal('REQUEST_TOO_LARGE'),
      Type.Literal('UNSUPPORTED_MEDIA_TYPE'), Type.Literal('METHOD_NOT_ALLOWED'),
      Type.Literal('NOT_FOUND'), Type.Literal('OVERLOADED'), Type.Literal('UNAVAILABLE'),
      Type.Literal('COMPUTE_TIMEOUT'), Type.Literal('INTERNAL_ERROR'),
    ]),
    message: Type.String({ maxLength: 256 }),
    requestId: Type.String({ minLength: 1, maxLength: 64 }),
  }, { additionalProperties: false }),
}, { additionalProperties: false });
export type ApiError = Static<typeof ApiErrorSchema>;
