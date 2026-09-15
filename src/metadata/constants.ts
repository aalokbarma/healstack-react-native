/** Default metadata bounds — overridable via HealStackOptions where noted. */
export const METADATA_DEFAULTS = {
  maxTags: 50,
  maxExtraKeys: 50,
  maxContextKeys: 20,
  maxTagKeyLength: 64,
  maxTagValueLength: 256,
  maxUserIdLength: 128,
  maxUserFieldLength: 256,
  maxUserExtraKeys: 10,
} as const;

export const METADATA_HARD_CAPS = {
  maxTags: 200,
  maxExtraKeys: 200,
  maxContextKeys: 50,
} as const;

/** Known user fields stored explicitly; extras are extensible but bounded. */
export const USER_KNOWN_FIELDS = new Set(['id', 'email', 'username', 'ip_address']);
