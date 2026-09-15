/** Default breadcrumb bounds — overridable via HealStackOptions. */
export const BREADCRUMB_DEFAULTS = {
  maxMessageSize: 1024,
  maxDataDepth: 3,
  maxDataKeys: 20,
  maxDataStringLength: 512,
} as const;

/** Hard caps for breadcrumb size options. */
export const BREADCRUMB_HARD_CAPS = {
  maxMessageSize: 8 * 1024,
} as const;
