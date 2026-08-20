import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router'
import { requireOwner, requireOwnerAndOnboarded, requirePlatformAdmin } from './guards'

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
      { path: 'claim', name: 'claim-club', component: () => import('@/views/auth/ClaimClubView.vue') },
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
      { path: 'members', name: 'members', component: () => import('@/views/members/MembersView.vue') },
      { path: 'members/:id', name: 'member-detail', component: () => import('@/views/members/MemberDetailView.vue') },
      { path: 'applications', name: 'applications', component: () => import('@/views/applications/ApplicationsView.vue') },
      { path: 'enquiries', name: 'enquiries', component: () => import('@/views/enquiries/EnquiriesView.vue') },
      { path: 'events', name: 'events', component: () => import('@/views/events/EventsView.vue') },
      { path: 'teams', name: 'teams', component: () => import('@/views/teams/TeamsView.vue') },
      { path: 'teams/:id', name: 'team-editor', component: () => import('@/views/teams/TeamEditorView.vue') },
      { path: 'honour-board', name: 'honour-board', component: () => import('@/views/honour-board/HonourBoardView.vue') },
      { path: 'achievements', name: 'achievements', component: () => import('@/views/achievements/AchievementsView.vue') },
      { path: 'website', name: 'website', component: () => import('@/views/website/WebsiteEditorView.vue') },
      { path: 'communications', name: 'communications', component: () => import('@/views/communications/CommunicationsView.vue') },
      { path: 'settings', name: 'settings', component: () => import('@/views/settings/SettingsView.vue') },
      { path: 'site-settings', name: 'site-settings', component: () => import('@/views/site-settings/SiteSettingsView.vue') },
    ],
  },
  { path: '/:pathMatch(.*)*', redirect: '/' },
]

export const router = createRouter({
  history: createWebHistory(),
  routes,
})
