/**
 * The NobleSee domain layer.
 *
 * Framework-independent by rule: nothing in `src/domain` may import
 * Payload, Next, React or a database client. Callers pass in the data
 * and the clock; these modules decide. See rights.ts for why.
 */
export * from './rights'
export * from './downloadLimit'
export * from './stagedRelease'
export * from './password'
export * from './kindle'
