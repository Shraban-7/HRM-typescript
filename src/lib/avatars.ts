import avatarVpPeople from '../assets/images/avatar_vp_people_1795446546985.jpg';
import avatarBranchManager from '../assets/images/avatar_branch_manager_1795446547221.jpg';
import avatarSeniorEngineer from '../assets/images/avatar_senior_engineer_1795446544652.jpg';

export const AVATAR_VP_PEOPLE = avatarVpPeople;
export const AVATAR_BRANCH_MANAGER = avatarBranchManager;
export const AVATAR_SENIOR_ENGINEER = avatarSeniorEngineer;

const SEEDED_AVATAR_MAP: Record<string, string> = {
  '/src/assets/images/avatar_vp_people_1795446546985.jpg': avatarVpPeople,
  '/src/assets/images/avatar_branch_manager_1795446547221.jpg': avatarBranchManager,
  '/src/assets/images/avatar_senior_engineer_1795446544652.jpg': avatarSeniorEngineer,
};

/**
 * Resolves seeded workspace portrait paths to Vite-bundled production asset URLs
 * so images load cleanly on both local dev servers and Vercel static builds.
 */
export function resolveAvatarUrl(src: string | null | undefined): string | null {
  if (!src) return null;
  return SEEDED_AVATAR_MAP[src] ?? src;
}
