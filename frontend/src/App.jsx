import { Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './contexts/AuthContext';
import ProtectedRoute   from './components/ProtectedRoute';
import LoginPage        from './pages/LoginPage';
import AppShell         from './layouts/AppShell';

import StatePage    from './pages/masters/StatePage';
import TaxPage      from './pages/masters/TaxPage';
import HolidayPage  from './pages/masters/HolidayPage';
import BankPage     from './pages/masters/BankPage';

import PartyListPage    from './pages/masters/PartyListPage';
import PartyFormPage    from './pages/masters/PartyFormPage';
import ItemListPage     from './pages/masters/ItemListPage';
import ItemFormPage     from './pages/masters/ItemFormPage';
import GodownListPage   from './pages/masters/GodownListPage';
import GodownFormPage   from './pages/masters/GodownFormPage';
import EmployeeListPage from './pages/masters/EmployeeListPage';
import EmployeeFormPage from './pages/masters/EmployeeFormPage';
import RateChartPage      from './pages/masters/RateChartPage';
import GodownLinkPage     from './pages/masters/GodownLinkPage';
import LocationListPage   from './pages/masters/LocationListPage';
import LocationFormPage   from './pages/masters/LocationFormPage';
import DocListPage        from './pages/masters/DocListPage';
import DocFormPage        from './pages/masters/DocFormPage';
import ComboDataListPage  from './pages/masters/ComboDataListPage';
import ComboDataFormPage  from './pages/masters/ComboDataFormPage';
import ArrivalListPage   from './pages/transactions/ArrivalListPage';
import ArrivalFormPage   from './pages/transactions/ArrivalFormPage';
import DispatchListPage  from './pages/transactions/DispatchListPage';
import DispatchFormPage  from './pages/transactions/DispatchFormPage';
import AttendancePage       from './pages/transactions/AttendancePage';
import HamaliCalPage        from './pages/transactions/HamaliCalPage';
import TransferOpnBalPage      from './pages/transactions/TransferOpnBalPage';
import TransferBetweenDbPage   from './pages/transactions/TransferBetweenDbPage';
import ModRatePage              from './pages/transactions/ModRatePage';
import BillingPage             from './pages/billing/BillingPage';
import BillGenPage             from './pages/billing/BillGenPage';
import ReceiptPage             from './pages/billing/ReceiptPage';
import BillLetterPage          from './pages/billing/BillLetterPage';
import BillNumberEditorPage    from './pages/billing/BillNumberEditorPage';

// Report pages
import HamaliCalReportPage  from './pages/reports/HamaliCalReportPage';
import BalanceReportPage    from './pages/reports/BalanceReportPage';
import AuditReportPage      from './pages/reports/AuditReportPage';
import BillReportPage       from './pages/reports/BillReportPage';
import ReceiptReportPage    from './pages/reports/ReceiptReportPage';

// Admin pages — manage groups, companies, roles, permissions, users
import CompanyGroupPage from './pages/admin/CompanyGroupPage';
import CompanyListPage  from './pages/admin/CompanyListPage';
import CompanyFormPage  from './pages/admin/CompanyFormPage';
import RolePage         from './pages/admin/RolePage';
import PermissionPage   from './pages/admin/PermissionPage';
import UserListPage     from './pages/admin/UserListPage';
import UserFormPage     from './pages/admin/UserFormPage';
import UpSerialNumPage       from './pages/admin/UpSerialNumPage';
import DatabaseBackupPage   from './pages/admin/DatabaseBackupPage';
import DashboardPage        from './pages/DashboardPage';

export default function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/login" element={<LoginPage />} />

        <Route
          path="/"
          element={
            <ProtectedRoute>
              <AppShell />
            </ProtectedRoute>
          }
        >
          <Route index element={<DashboardPage />} />

          {/* ── Masters ── */}
          <Route path="masters/state"   element={<ProtectedRoute moduleCode="MASTERS"><StatePage /></ProtectedRoute>} />
          <Route path="masters/tax"     element={<ProtectedRoute moduleCode="MASTERS"><TaxPage /></ProtectedRoute>} />
          <Route path="masters/holiday" element={<ProtectedRoute moduleCode="MASTERS"><HolidayPage /></ProtectedRoute>} />
          <Route path="masters/bank"    element={<ProtectedRoute moduleCode="MASTERS"><BankPage /></ProtectedRoute>} />

          <Route path="masters/parties"          element={<ProtectedRoute moduleCode="PARTY"><PartyListPage /></ProtectedRoute>} />
          <Route path="masters/parties/new"      element={<ProtectedRoute moduleCode="PARTY"><PartyFormPage /></ProtectedRoute>} />
          <Route path="masters/parties/:id/edit" element={<ProtectedRoute moduleCode="PARTY"><PartyFormPage /></ProtectedRoute>} />

          <Route path="masters/items"          element={<ProtectedRoute moduleCode="ITEM_MASTER"><ItemListPage /></ProtectedRoute>} />
          <Route path="masters/items/new"      element={<ProtectedRoute moduleCode="ITEM_MASTER"><ItemFormPage /></ProtectedRoute>} />
          <Route path="masters/items/:id/edit" element={<ProtectedRoute moduleCode="ITEM_MASTER"><ItemFormPage /></ProtectedRoute>} />

          <Route path="masters/godowns"          element={<ProtectedRoute moduleCode="MASTERS"><GodownListPage /></ProtectedRoute>} />
          <Route path="masters/godowns/new"      element={<ProtectedRoute moduleCode="MASTERS"><GodownFormPage /></ProtectedRoute>} />
          <Route path="masters/godowns/:id/edit" element={<ProtectedRoute moduleCode="MASTERS"><GodownFormPage /></ProtectedRoute>} />

          <Route path="masters/employees"          element={<ProtectedRoute moduleCode="MASTERS"><EmployeeListPage /></ProtectedRoute>} />
          <Route path="masters/employees/new"      element={<ProtectedRoute moduleCode="MASTERS"><EmployeeFormPage /></ProtectedRoute>} />
          <Route path="masters/employees/:id/edit" element={<ProtectedRoute moduleCode="MASTERS"><EmployeeFormPage /></ProtectedRoute>} />

          <Route path="masters/ratechart"    element={<ProtectedRoute moduleCode="MASTERS"><RateChartPage /></ProtectedRoute>} />
          <Route path="masters/godown-links" element={<ProtectedRoute moduleCode="MASTERS"><GodownLinkPage /></ProtectedRoute>} />

          <Route path="masters/locations"          element={<ProtectedRoute moduleCode="MASTERS"><LocationListPage /></ProtectedRoute>} />
          <Route path="masters/locations/new"      element={<ProtectedRoute moduleCode="MASTERS"><LocationFormPage /></ProtectedRoute>} />
          <Route path="masters/locations/:id/edit" element={<ProtectedRoute moduleCode="MASTERS"><LocationFormPage /></ProtectedRoute>} />

          <Route path="masters/docfiles"          element={<ProtectedRoute moduleCode="DOCUMENTS"><DocListPage /></ProtectedRoute>} />
          <Route path="masters/docfiles/new"      element={<ProtectedRoute moduleCode="DOCUMENTS"><DocFormPage /></ProtectedRoute>} />
          <Route path="masters/docfiles/:id/edit" element={<ProtectedRoute moduleCode="DOCUMENTS"><DocFormPage /></ProtectedRoute>} />

          <Route path="masters/combo-data"          element={<ProtectedRoute moduleCode="COMBO_DATA"><ComboDataListPage /></ProtectedRoute>} />
          <Route path="masters/combo-data/new"      element={<ProtectedRoute moduleCode="COMBO_DATA"><ComboDataFormPage /></ProtectedRoute>} />
          <Route path="masters/combo-data/:id/edit" element={<ProtectedRoute moduleCode="COMBO_DATA"><ComboDataFormPage /></ProtectedRoute>} />

          {/* ── Transactions ── */}
          <Route path="transactions/arrivals"          element={<ProtectedRoute moduleCode="ARRIVAL"><ArrivalListPage /></ProtectedRoute>} />
          <Route path="transactions/arrivals/new"      element={<ProtectedRoute moduleCode="ARRIVAL"><ArrivalFormPage /></ProtectedRoute>} />
          <Route path="transactions/arrivals/edit"     element={<ProtectedRoute moduleCode="ARRIVAL"><ArrivalFormPage /></ProtectedRoute>} />
          <Route path="transactions/arrivals/:id/edit" element={<ProtectedRoute moduleCode="ARRIVAL"><ArrivalFormPage /></ProtectedRoute>} />

          <Route path="transactions/dispatches"          element={<ProtectedRoute moduleCode="DELIVERY"><DispatchListPage /></ProtectedRoute>} />
          <Route path="transactions/dispatches/new"      element={<ProtectedRoute moduleCode="DELIVERY"><DispatchFormPage /></ProtectedRoute>} />
          <Route path="transactions/dispatches/:id/edit" element={<ProtectedRoute moduleCode="DELIVERY"><DispatchFormPage /></ProtectedRoute>} />

          <Route path="transactions/attendance"        element={<ProtectedRoute moduleCode="ATTENDANCE"><AttendancePage /></ProtectedRoute>} />
          <Route path="transactions/hamali"            element={<ProtectedRoute moduleCode="HAMALI"><HamaliCalPage /></ProtectedRoute>} />
          <Route path="transactions/transfer-opn-bal"    element={<ProtectedRoute moduleCode="TRF_OPN_BAL"><TransferOpnBalPage /></ProtectedRoute>} />
          <Route path="transactions/transfer-between-db" element={<ProtectedRoute moduleCode="TRF_DB"><TransferBetweenDbPage /></ProtectedRoute>} />
          <Route path="transactions/mod-rate"            element={<ProtectedRoute moduleCode="MOD_RATE"><ModRatePage /></ProtectedRoute>} />

          {/* ── Billing ── */}
          <Route path="billing/bills"       element={<ProtectedRoute moduleCode="BILL_GEN"><BillingPage /></ProtectedRoute>} />
          <Route path="billing/godrent"     element={<ProtectedRoute moduleCode="BILL_GEN"><BillGenPage /></ProtectedRoute>} />
          <Route path="billing/receipts"    element={<ProtectedRoute moduleCode="RECEIPT_ENTRY"><ReceiptPage /></ProtectedRoute>} />
          <Route path="billing/bill-letter"   element={<ProtectedRoute moduleCode="BILL_LETTER"><BillLetterPage /></ProtectedRoute>} />
          <Route path="billing/bill-numbers" element={<ProtectedRoute moduleCode="BILL_NUM_EDIT"><BillNumberEditorPage /></ProtectedRoute>} />

          {/* ── Reports ── */}
          <Route path="reports/hamali-report"  element={<ProtectedRoute moduleCode="HAMALI_REP"><HamaliCalReportPage /></ProtectedRoute>} />
          <Route path="reports/balance-report" element={<ProtectedRoute moduleCode="BAL_REP"><BalanceReportPage /></ProtectedRoute>} />
          <Route path="reports/audit-report"   element={<ProtectedRoute moduleCode="AUDIT_REP"><AuditReportPage /></ProtectedRoute>} />
          <Route path="reports/bill-report"    element={<ProtectedRoute moduleCode="BILL_REP"><BillReportPage /></ProtectedRoute>} />
          <Route path="reports/receipt-report" element={<ProtectedRoute moduleCode="RECEIPT_REP"><ReceiptReportPage /></ProtectedRoute>} />

          {/* ── Admin ── */}
          <Route path="admin/company-groups"   element={<ProtectedRoute moduleCode="ADMIN"><CompanyGroupPage /></ProtectedRoute>} />
          <Route path="admin/companies"        element={<ProtectedRoute moduleCode="ADMIN"><CompanyListPage /></ProtectedRoute>} />
          <Route path="admin/companies/:id"    element={<ProtectedRoute moduleCode="ADMIN"><CompanyFormPage /></ProtectedRoute>} />
          <Route path="admin/roles"            element={<ProtectedRoute moduleCode="ADMIN"><RolePage /></ProtectedRoute>} />
          <Route path="admin/permissions"      element={<ProtectedRoute moduleCode="ADMIN"><PermissionPage /></ProtectedRoute>} />
          <Route path="admin/users"            element={<ProtectedRoute moduleCode="ADMIN"><UserListPage /></ProtectedRoute>} />
          <Route path="admin/users/:id"        element={<ProtectedRoute moduleCode="ADMIN"><UserFormPage /></ProtectedRoute>} />
          <Route path="admin/up-serial-num"    element={<ProtectedRoute moduleCode="UP_SERIAL_NUM"><UpSerialNumPage /></ProtectedRoute>} />
          <Route path="admin/database-backup"  element={<ProtectedRoute moduleCode="ADMIN"><DatabaseBackupPage /></ProtectedRoute>} />
        </Route>

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AuthProvider>
  );
}
