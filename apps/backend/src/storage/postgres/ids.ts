import type { Id, Seq } from '@earendil-works/pi-durable'

/**
 * Durable brands `Id` and `Seq` as numbers with no runtime component, so the assertion is the only way to produce one.
 * Every caller here derives the value from a `bigint` column, which the driver hands back as a string.
 */
export const idFromNumber = <I extends Id<string>>(value: number): I => value as I

/** See `idFromNumber`. */
export const seqFromNumber = (value: number): Seq => value as Seq
