import { customType } from 'drizzle-orm/sqlite-core';
import { sql, type SQL } from 'drizzle-orm';

export const float32Array = customType<{ data: number[]; config: { dimensions: number }; driverData: Buffer }>({
  dataType(config) {
    return `F32_BLOB(${config!.dimensions})`;
  },
  fromDriver(value: Buffer): number[] {
    return Array.from(new Float32Array(value.buffer, value.byteOffset, value.byteLength / 4));
  },
  toDriver(value: number[]): SQL {
    return sql`vector32(${JSON.stringify(value)})`;
  },
});
