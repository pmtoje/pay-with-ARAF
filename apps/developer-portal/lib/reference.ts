/**
 * Reference data imported directly from the dependency-free source files the API itself uses
 * (see `experimental.externalDir` in next.config.mjs), so the docs cannot drift from the code.
 */
export { API_SCOPES, type ApiScope } from '../../../packages/types/src/rbac';
export { WEBHOOK_EVENT_TYPES, WEBHOOK_SCHEMA_VERSION, type WebhookEventType } from '../../../packages/types/src/events';
export { ERRORS, type ErrorCode } from '../../../packages/types/src/errors';
export { SANDBOX_IDENTITIES } from '../../../packages/integrations/src/sandbox/scenarios';
