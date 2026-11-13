import { useAuth } from '../contexts/AuthContext';

// Usage:  const { canAdd, canEdit, canDelete, canPrint, canExport } = usePermissions('PARTY');
export function usePermissions(moduleCode) {
  const { can } = useAuth();
  return {
    canView:   can(moduleCode, 'CanView'),
    canAdd:    can(moduleCode, 'CanAdd'),
    canEdit:   can(moduleCode, 'CanEdit'),
    canDelete: can(moduleCode, 'CanDelete'),
    canPrint:  can(moduleCode, 'CanPrint'),
    canExport: can(moduleCode, 'CanExport'),
  };
}
