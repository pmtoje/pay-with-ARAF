/**
 * Reference data imported from the dependency-free source files in packages/ (see
 * `experimental.externalDir` in next.config.mjs), so scopes and event types never drift from the API.
 */
export { API_SCOPES, type ApiScope } from '../../../packages/types/src/rbac';
export { WEBHOOK_EVENT_TYPES, type WebhookEventType } from '../../../packages/types/src/events';
