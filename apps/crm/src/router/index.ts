import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router'
import { permissionGate, requireAuthOrRegister, requireOwner, requireOwnerAndOnboarded, requirePlatformAdmin } from './guards'

const CrmShell = () => import('@/layouts/CrmShell.vue')
const AuthShell = () => import('@/layouts/AuthShell.vue')
const OnboardingShell = () => import('@/layouts/OnboardingShell.vue')
const AdminShell = () => import('@/layouts/AdminShell.vue')

const routes: RouteRecordRaw[] = [
  {
    path: '/',
    component: AuthShell,
    children: [
      { path: '', name: 'sign-in', component: () => import('@/views/auth/SignInView.vue') },
      { path: 'register', name: 'register', component: () => import('@/views/auth/RegisterView.vue') },
      { path: 'forgot-password', name: 'forgot-password', component: () => import('@/views/auth/ForgotPasswordView.vue') },
      { path: 'reset-password', name: 'reset-password', component: () => import('@/views/auth/ResetPasswordView.vue') },
      { path: 'confirm-email/:token', name: 'confirm-email', component: () => import('@/views/account/ConfirmEmailView.vue') },
      { path: 'accept-invite/:token', name: 'accept-invite', component: () => import('@/views/auth/AcceptInviteView.vue') },
      { path: 'claim', name: 'claim-club', component: () => import('@/views/auth/ClaimClubView.vue'), beforeEnter: requireAuthOrRegister },
      { path: 'forbidden', name: 'forbidden', component: () => import('@/views/auth/ForbiddenView.vue') },
    ],
  },
  {
    path: '/admin',
    component: AdminShell,
    beforeEnter: requirePlatformAdmin,
    children: [
      { path: '', name: 'admin-dashboard', component: () => import('@/views/admin/AdminDashboardView.vue') },
      { path: 'claims', name: 'admin-claims', component: () => import('@/views/admin/AdminClaimsView.vue') },
      { path: 'clubs', name: 'admin-clubs', component: () => import('@/views/admin/AdminClubsView.vue') },
      { path: 'members', name: 'admin-members', component: () => import('@/views/admin/AdminMembersView.vue') },
      { path: 'users', name: 'admin-users', component: () => import('@/views/admin/AdminUsersView.vue') },
    ],
  },
  {
    path: '/crm/onboarding',
    component: OnboardingShell,
    beforeEnter: requireOwner,
    children: [
      { path: '', redirect: { name: 'onboarding-welcome' } },
      { path: 'welcome', name: 'onboarding-welcome', component: () => import('@/views/onboarding/WelcomeView.vue') },
      { path: 'club-basics', name: 'onboarding-step-1', component: () => import('@/views/onboarding/Step1BasicsView.vue') },
      { path: 'location', name: 'onboarding-step-2', component: () => import('@/views/onboarding/Step2LocationView.vue') },
      { path: 'contact', name: 'onboarding-step-3', component: () => import('@/views/onboarding/Step3ContactView.vue') },
      { path: 'membership', name: 'onboarding-step-4', component: () => import('@/views/onboarding/Step4MembershipView.vue') },
      { path: 'brand', name: 'onboarding-step-5', component: () => import('@/views/onboarding/Step5BrandView.vue') },
      { path: 'website', name: 'onboarding-step-6', component: () => import('@/views/onboarding/Step6WebsiteView.vue') },
      { path: 'complete', name: 'onboarding-complete', component: () => import('@/views/onboarding/CompleteView.vue') },
    ],
  },
  {
    path: '/crm',
    component: CrmShell,
    beforeEnter: requireOwnerAndOnboarded,
    children: [
      { path: '', redirect: { name: 'dashboard' } },
      { path: 'dashboard', name: 'dashboard', component: () => import('@/views/dashboard/DashboardView.vue') },
      { path: 'members', name: 'members', component: () => import('@/views/members/MembersView.vue'), meta: { permission: 'members:read' } },
      { path: 'members/import', name: 'members-import', component: () => import('@/views/members/MembersImportView.vue'), meta: { permission: 'members:write' } },
      { path: 'members/:id', name: 'member-detail', component: () => import('@/views/members/MemberDetailView.vue'), meta: { permission: 'members:read' } },
      { path: 'applications', name: 'applications', component: () => import('@/views/applications/ApplicationsView.vue'), meta: { permission: 'applications:read' } },
      { path: 'applications/:id', name: 'application-detail', component: () => import('@/views/applications/ApplicationDetailView.vue'), meta: { permission: 'applications:read' } },
      { path: 'enquiries', name: 'enquiries', component: () => import('@/views/enquiries/EnquiriesView.vue'), meta: { permission: 'enquiries:read' } },
      { path: 'enquiries/:id', name: 'enquiry-detail', component: () => import('@/views/enquiries/EnquiryDetailView.vue'), meta: { permission: 'enquiries:read' } },
      { path: 'venue-bookings', name: 'venue-bookings', component: () => import('@/views/venue-bookings/VenueBookingsView.vue'), meta: { permission: 'venue_bookings:read', requiresPro: true } },
      { path: 'venue-bookings/:id', name: 'venue-booking-detail', component: () => import('@/views/venue-bookings/VenueBookingDetailView.vue'), meta: { permission: 'venue_bookings:read', requiresPro: true } },
      { path: 'venue-packages', name: 'venue-packages', component: () => import('@/views/venue-packages/VenuePackagesView.vue'), meta: { permission: 'venue_packages:read', requiresPro: true } },
      { path: 'venue-packages/settings', name: 'venue-packages-settings', component: () => import('@/views/venue-packages/VenuePackageSettingsView.vue'), meta: { permission: 'venue_packages:edit', requiresPro: true } },
      { path: 'venue-packages/new', name: 'venue-package-new', component: () => import('@/views/venue-packages/VenuePackageEditorView.vue'), meta: { permission: 'venue_packages:edit', requiresPro: true } },
      { path: 'venue-packages/:id', name: 'venue-package-edit', component: () => import('@/views/venue-packages/VenuePackageEditorView.vue'), meta: { permission: 'venue_packages:edit', requiresPro: true } },
      { path: 'events', name: 'events', component: () => import('@/views/events/EventsView.vue'), meta: { permission: 'events:read' } },
      { path: 'teams', name: 'teams', component: () => import('@/views/teams/TeamsView.vue'), meta: { permission: 'team_selections:read', requiresPro: true } },
      { path: 'teams/:id', name: 'team-editor', component: () => import('@/views/teams/TeamEditorView.vue'), meta: { permission: 'team_selections:read', requiresPro: true } },
      { path: 'honour-board', name: 'honour-board', component: () => import('@/views/honour-board/HonourBoardView.vue'), meta: { permission: 'honour_board:read', requiresPro: true } },
      { path: 'tournaments', name: 'tournaments', component: () => import('@/views/tournaments/TournamentsListView.vue'), meta: { permission: 'tournaments:read', requiresPro: true } },
      { path: 'tournaments/settings', name: 'tournament-settings', component: () => import('@/views/tournaments/TournamentSettingsView.vue'), meta: { permission: 'tournaments:edit', requiresPro: true } },
      { path: 'tournaments/new', name: 'tournament-new', component: () => import('@/views/tournaments/TournamentFormView.vue'), meta: { permission: 'tournaments:edit', requiresPro: true } },
      { path: 'tournaments/:id', name: 'tournament-detail', component: () => import('@/views/tournaments/TournamentDetailView.vue'), meta: { permission: 'tournaments:read', requiresPro: true } },
      { path: 'tournaments/:id/edit', name: 'tournament-edit', component: () => import('@/views/tournaments/TournamentFormView.vue'), meta: { permission: 'tournaments:edit', requiresPro: true } },
      { path: 'tournaments/:id/results', name: 'tournament-results', component: () => import('@/views/tournaments/TournamentResultsView.vue'), meta: { permission: 'tournaments:edit', requiresPro: true } },
      { path: 'website', redirect: { name: 'website', params: { pageSlug: 'home' } } },
      { path: 'website/:pageSlug', name: 'website', component: () => import('@/views/website/WebsiteEditorView.vue'), meta: { permission: 'website:view' } },
      { path: 'communications', name: 'communications', component: () => import('@/views/communications/CommunicationsView.vue'), meta: { permission: 'communications:read' } },
      { path: 'communications/compose', name: 'compose', component: () => import('@/views/communications/ComposeView.vue'), meta: { permission: 'communications:send' } },
      { path: 'communications/templates', name: 'templates', component: () => import('@/views/communications/TemplatesIndexView.vue'), meta: { permission: 'communications:send' } },
      { path: 'communications/templates/wrap', name: 'template-wrap', component: () => import('@/views/communications/WrapEditView.vue'), meta: { permission: 'communications:send' } },
      { path: 'communications/templates/:slug', name: 'template-edit', component: () => import('@/views/communications/TemplateEditView.vue'), meta: { permission: 'communications:send' } },
      { path: 'communications/:id', name: 'campaign-detail', component: () => import('@/views/communications/CampaignDetailView.vue'), meta: { permission: 'communications:read' } },
      // Each settings panel has its own URL so bookmarks + browser back/forward
      // work naturally. Shell component is shared — it reads :section from params.
      { path: 'settings/:section?', name: 'settings', component: () => import('@/views/settings/SettingsView.vue') },
      { path: 'settings/stripe/callback', name: 'stripe-callback', component: () => import('@/views/settings/StripeCallbackView.vue') },
      { path: 'billing/success', name: 'billing-success', component: () => import('@/views/settings/BillingSuccessView.vue') },
      { path: 'account', name: 'account', component: () => import('@/views/account/AccountView.vue') },
      { path: 'site-settings', redirect: { name: 'website', params: { pageSlug: 'domain' } } },
    ],
  },
  { path: '/:pathMatch(.*)*', redirect: '/' },
]

export const router = createRouter({
  history: createWebHistory(),
  routes,
  // Reset scroll on every navigation so new pages start at the top.
  // Browser back/forward still restores where the user was via
  // savedPosition, and in-page anchors (#foo) still scroll to the target.
  scrollBehavior(to, _from, savedPosition) {
    if (savedPosition) return savedPosition
    if (to.hash) return { el: to.hash, behavior: 'smooth' }
    return { top: 0 }
  },
})

// Per-route permission + plan gating. Reads `meta.permission` /
// `meta.requiresPro` off the destination; no-op on routes that omit both.
// Runs globally so direct-URL access can't bypass the sidebar filter.
router.beforeEach(permissionGate)
