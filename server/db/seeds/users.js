// Seed organizations and users, shared by the seed script and the tests so both use the same data.
// Passwords are never stored here: every seed user gets SEED_PASSWORD from server/.env.

export const SEED_ORGS = {
  acme: { name: 'Acme Corp', slug: 'acme-corp' },
  globex: { name: 'Globex', slug: 'globex' },
};

// Keyed by org, then by a short handle that says the role (USERS.acme.tech1.email in tests).
export const USERS = {
  acme: {
    admin: { name: 'Avery Admin', email: 'admin@acme.test', role: 'admin', department: 'IT' },
    tech1: { name: 'Taylor Tech', email: 'tech1@acme.test', role: 'technician', department: 'IT' },
    tech2: { name: 'Jordan Ruiz', email: 'tech2@acme.test', role: 'technician', department: 'IT' },
    user1: { name: 'Erin Walsh', email: 'user1@acme.test', role: 'end_user', department: 'Sales' },
    user2: { name: 'Sam Patel', email: 'user2@acme.test', role: 'end_user', department: 'Finance' },
    user3: { name: 'Chris Nguyen', email: 'user3@acme.test', role: 'end_user', department: 'HR' },
  },
  globex: {
    admin: { name: 'Morgan Lee', email: 'admin@globex.test', role: 'admin', department: 'IT' },
    tech1: { name: 'Riley Chen', email: 'tech1@globex.test', role: 'technician', department: 'IT' },
    tech2: {
      name: 'Casey Brooks',
      email: 'tech2@globex.test',
      role: 'technician',
      department: 'IT',
    },
    user1: {
      name: 'Dana Kim',
      email: 'user1@globex.test',
      role: 'end_user',
      department: 'Marketing',
    },
    user2: {
      name: 'Alex Morgan',
      email: 'user2@globex.test',
      role: 'end_user',
      department: 'Operations',
    },
    user3: { name: 'Jamie Fox', email: 'user3@globex.test', role: 'end_user', department: 'Legal' },
  },
};
