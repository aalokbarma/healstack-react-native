/**
 * Package identity constants.
 * Keep in sync with package.json version until build-time injection lands.
 */
export const SDK_NAME = '@healstack/react-native' as const;
export const SDK_VERSION = '0.1.0' as const;
/**
 * @deprecated Prefer `WIRE_SCHEMA_VERSION` for ingest schema identity.
 * Kept equal to the wire schema for compatibility.
 */
export const SCHEMA_VERSION = 1 as const;
