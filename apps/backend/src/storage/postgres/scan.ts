import type { Cursor, ScanOrder } from '@earendil-works/pi-durable'
import { StorageRequestError } from '@earendil-works/pi-durable'

/** Where a scan starts: its order (the cursor's wins) and the last ID already returned. */
export type ScanStart = { order: ScanOrder; after: number | undefined }

/**
 * Resolve a scan's order and position. A cursor continues in the order it was created with; a query asking for the
 * other order throws. The cursor is stored JSON, so its fields are validated rather than trusted.
 */
export const scanStart = (
	cursor: Cursor | undefined,
	fallback: ScanOrder,
	requested: ScanOrder | undefined = undefined,
): ScanStart => {
	if (cursor === undefined) return { order: requested ?? fallback, after: undefined }
	const after = cursor['after']
	const stored = cursor['order']
	if (typeof after !== 'number' || !Number.isSafeInteger(after)) {
		throw new StorageRequestError('Invalid storage cursor')
	}
	if (stored !== undefined && stored !== 'ascending' && stored !== 'descending') {
		throw new StorageRequestError('Invalid storage cursor')
	}
	const order = stored ?? fallback
	if (requested !== undefined && requested !== order) {
		throw new StorageRequestError(`The cursor continues a ${order} scan; the query asks for ${requested}`)
	}
	return { order, after }
}

/** The continuation of a scan whose last returned item has `id`. */
export const nextCursor = (id: number, order: ScanOrder): Cursor => ({ after: id, order })
