// Every route in the app: public pages, signed-in pages inside the shell, and admin-only pages.
import { Navigate, Route, Routes } from 'react-router-dom';
import { RequireAuth } from './auth/RequireAuth.jsx';
import { RequireRole } from './auth/RequireRole.jsx';
import { AdminCategoriesPage } from './features/admin/AdminCategoriesPage.jsx';
import { AdminSlaPage } from './features/admin/AdminSlaPage.jsx';
import { AdminUsersPage } from './features/admin/AdminUsersPage.jsx';
import { LoginPage } from './features/auth/LoginPage.jsx';
import { RegisterPage } from './features/auth/RegisterPage.jsx';
import { NotFoundPage } from './features/NotFoundPage.jsx';
import { NewTicketPage } from './features/tickets/NewTicketPage.jsx';
import { TicketDetailPage } from './features/tickets/TicketDetailPage.jsx';
import { TicketQueuePage } from './features/tickets/TicketQueuePage.jsx';
import { AppLayout } from './layouts/AppLayout.jsx';

export default function App() {
  // ----- State -----
  // none

  // ----- Data -----
  // none

  // ----- Handlers -----
  // none

  // ----- Render -----
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />

      <Route element={<RequireAuth />}>
        <Route element={<AppLayout />}>
          <Route index element={<Navigate to="/tickets" replace />} />
          <Route path="tickets" element={<TicketQueuePage />} />
          <Route path="tickets/new" element={<NewTicketPage />} />
          <Route path="tickets/:id" element={<TicketDetailPage />} />

          <Route path="admin" element={<RequireRole roles={['admin']} />}>
            <Route path="users" element={<AdminUsersPage />} />
            <Route path="categories" element={<AdminCategoriesPage />} />
            <Route path="sla" element={<AdminSlaPage />} />
          </Route>

          {/* Inside the shell, so a signed-in user keeps the navigation on a bad link. */}
          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Route>
    </Routes>
  );
}
