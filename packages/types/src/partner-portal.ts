import { z } from 'zod';
import type { PermissionCode } from './rbac';

/**
 * Partner-side (partners.araf.ng) settings for one partner, configured by the Bank's Super Admin
 * (maker) and approved by a Partner Approving Officer (checker). Dashboard and account security are
 * always available; every other section can be switched off for a partner.
 */
export const PARTNER_PORTAL_MODULES = {
  applications: { label: 'Applications', description: 'View financing applications and request cancellations or returns.', permissions: ['p.application.read', 'p.refund.request'] },
  release: { label: 'Ready for release', description: 'Confirm dispatch and delivery once the Bank authorises release.', permissions: ['p.fulfilment.manage'] },
  settlements: { label: 'Settlements', description: 'See vendor payments made by the Bank.', permissions: ['p.settlement.read'] },
  integration: { label: 'Integration', description: 'Checkout button, API keys, webhooks and logs.', permissions: ['p.integration.read', 'p.integration.manage'] },
  team: { label: 'Team', description: 'Invite and manage the partner’s own staff.', permissions: ['p.team.manage'] },
  exports: { label: 'Report exports', description: 'Download CSV reports.', permissions: ['p.report.export'] },
} as const satisfies Record<string, { label: string; description: string; permissions: PermissionCode[] }>;

export type PartnerPortalModule = keyof typeof PARTNER_PORTAL_MODULES;
const MODULE_KEYS = Object.keys(PARTNER_PORTAL_MODULES) as [PartnerPortalModule, ...PartnerPortalModule[]];

export const partnerPortalSettingsSchema = z
  .object({
    modules: z.object(Object.fromEntries(MODULE_KEYS.map((k) => [k, z.boolean()])) as Record<PartnerPortalModule, z.ZodBoolean>).strict(),
    checkout_button: z
      .object({
        /** The label is fixed by the Bank; only the style and the amount display vary per partner. */
        theme: z.enum(['dark', 'gold']),
        show_amount: z.boolean(),
      })
      .strict(),
    max_users: z.number().int().min(1).max(500),
    support: z
      .object({
        email: z.string().email().max(254).nullable(),
        phone: z.string().regex(/^\+?\d{10,15}$/).nullable(),
      })
      .strict(),
  })
  .strict();

export type PartnerPortalSettings = z.infer<typeof partnerPortalSettingsSchema>;

export const DEFAULT_PARTNER_PORTAL_SETTINGS: PartnerPortalSettings = {
  modules: { applications: true, release: true, settlements: true, integration: true, team: true, exports: true },
  checkout_button: { theme: 'dark', show_amount: true },
  max_users: 25,
  support: { email: null, phone: null },
};

/** Stored settings (or defaults when the Super Admin has not configured the partner yet). */
export function effectivePortalSettings(stored: unknown): PartnerPortalSettings {
  const r = partnerPortalSettingsSchema.safeParse(stored);
  return r.success ? r.data : DEFAULT_PARTNER_PORTAL_SETTINGS;
}

/** Partner-portal permissions removed because their section is switched off for the partner. */
export function disabledPortalPermissions(settings: PartnerPortalSettings): Set<string> {
  const off = new Set<string>();
  for (const [k, m] of Object.entries(PARTNER_PORTAL_MODULES)) if (!settings.modules[k as PartnerPortalModule]) m.permissions.forEach((p) => off.add(p));
  return off;
}
