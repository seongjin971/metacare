import { createContext, useContext } from 'react';

export type AppRole = 'patient' | 'caregiver';
export const RoleActions = createContext<{ changeRole: () => void } | null>(null);
export function useRoleActions() { return useContext(RoleActions); }
