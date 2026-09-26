import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

export const DEFAULT_PAGE_LIMIT = 20;
export const MAX_PAGE_LIMIT = 100;

export class PageQueryDto {
  @ApiPropertyOptional({ minimum: 1, maximum: MAX_PAGE_LIMIT, default: DEFAULT_PAGE_LIMIT })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_PAGE_LIMIT)
  limit: number = DEFAULT_PAGE_LIMIT;

  @ApiPropertyOptional({ description: 'Opaque cursor from `page.nextCursor`.' })
  @IsOptional()
  @IsString()
  @MaxLength(512)
  cursor?: string;
}

export interface Page<T> {
  data: T[];
  page: { nextCursor: string | null; hasMore: boolean };
}

/**
 * Build a page from rows fetched with `take: limit + 1`: the extra row only tells us whether more exist.
 * `keyOf` returns the keyset position of the last returned row.
 */
export function toPage<T>(rows: T[], limit: number, keyOf: (row: T) => Record<string, unknown>, encode: (k: Record<string, unknown>) => string): Page<T> {
  const hasMore = rows.length > limit;
  const data = hasMore ? rows.slice(0, limit) : rows;
  const last = data[data.length - 1];
  return { data, page: { nextCursor: hasMore && last ? encode(keyOf(last)) : null, hasMore } };
}
