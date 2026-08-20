import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router'
import { requireOwner } from './guards'

const CrmShell = () => import('@/layouts/CrmShell.vue')
const AuthShell = () => import('@/layouts/AuthShell.vue')

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
    path: '/crm',
    component: CrmShell,
    beforeEnter: requireOwner,
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
