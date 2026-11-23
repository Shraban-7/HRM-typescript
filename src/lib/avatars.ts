export const AVATAR_VP_PEOPLE = '/images/avatar_vp_people_1795446546985.jpg';
export const AVATAR_BRANCH_MANAGER = '/images/avatar_branch_manager_1795446547221.jpg';
export const AVATAR_SENIOR_ENGINEER = '/images/avatar_senior_engineer_1795446544652.jpg';

const LEGACY_AVATAR_MAP: Record<string, string> = {
  '/src/assets/images/avatar_vp_people_1795446546985.jpg': AVATAR_VP_PEOPLE,
  '/src/assets/images/avatar_branch_manager_1795446547221.jpg': AVATAR_BRANCH_MANAGER,
  '/src/assets/images/avatar_senior_engineer_1795446544652.jpg': AVATAR_SENIOR_ENGINEER,
};

/**
 * Resolves seeded workspace portrait paths to Next.js public/images static URLs
 * so images load cleanly in local dev, production builds, and Vercel CDN.
 */
export function resolveAvatarUrl(src: string | null | undefined): string | null {
  if (!src) return null;
  return LEGACY_AVATAR_MAP[src] ?? src;
}
