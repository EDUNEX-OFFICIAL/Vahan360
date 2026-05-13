import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';

/** Mark a controller or route handler as public (no JWT required). */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
